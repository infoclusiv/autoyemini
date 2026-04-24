(function registerChatGPTRemoteRuntime() {
  const GENERATED_ATTACHMENT_KIND_SET = new Set(["prompts_file", "scripts_file"]);
  const GENERATED_ATTACHMENT_LABELS = {
    prompts_file: "Prompts TXT",
    scripts_file: "Scripts TXT"
  };

  const runtimeState = {
    isRunning: false,
    workflow: null,
    workflowId: "",
    workflowName: "",
    stepIndex: -1,
    pendingQuestion: null,
    workflowContext: null,
    settings: {
      useTempChat: true,
      useWebSearch: true,
      keepSameChat: false
    }
  };

  function addRemoteLog(message, level = "info") {
    try {
      forwardToSidePanel({ type: "LOG_MESSAGE", message: `[Remote ChatGPT] ${message}`, level });
    } catch {
    }
  }

  function notifyWorkflowStatus(payload) {
    if (globalThis.ChatGPTRemoteBridge?.notifyWorkflowStatus) {
      globalThis.ChatGPTRemoteBridge.notifyWorkflowStatus(payload);
    }
  }

  function resetRuntimeState() {
    runtimeState.isRunning = false;
    runtimeState.workflow = null;
    runtimeState.workflowId = "";
    runtimeState.workflowName = "";
    runtimeState.stepIndex = -1;
    runtimeState.pendingQuestion = null;
    runtimeState.workflowContext = null;
  }

  function getStepDisplayName(step, stepIndex) {
    return step?.title || `Step ${stepIndex + 1}`;
  }

  async function loadRunnerSettings() {
    const stored = await chrome.storage.local.get([
      CONFIG.STORAGE_KEYS.USE_TEMP_CHAT,
      CONFIG.STORAGE_KEYS.USE_WEB_SEARCH,
      CONFIG.STORAGE_KEYS.KEEP_SAME_CHAT
    ]);

    return {
      useTempChat: stored[CONFIG.STORAGE_KEYS.USE_TEMP_CHAT] !== false,
      useWebSearch: stored[CONFIG.STORAGE_KEYS.USE_WEB_SEARCH] !== false,
      keepSameChat: stored[CONFIG.STORAGE_KEYS.KEEP_SAME_CHAT] === true
    };
  }

  function countStoredSteps(workflow) {
    return (workflow?.steps || []).reduce((count, step) => {
      return count + (step?.chainConfig?.responseAction === "store_full" ? 1 : 0);
    }, 0);
  }

  function getStoredStepIndexes(workflow) {
    return (workflow?.steps || []).reduce((indexes, step, index) => {
      if (step?.chainConfig?.responseAction === "store_full") {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }

  function getExpectedGeneratedArtifactKindsForStep(workflow, sourceStepIndex) {
    if (!workflow || !Array.isArray(workflow.steps)) {
      return [];
    }

    const expectedKinds = [];
    workflow.steps.forEach((step, stepIndex) => {
      if (!step || stepIndex <= sourceStepIndex) {
        return;
      }

      const attachmentConfig = step.attachmentConfig || {};
      if (attachmentConfig.enabled !== true || attachmentConfig.mode !== "generated") {
        return;
      }

      const normalizedSourceStepIndex = normalizeGeneratedSourceStepIndex(
        attachmentConfig.sourceStepIndex,
        stepIndex
      );
      if (normalizedSourceStepIndex !== sourceStepIndex) {
        return;
      }

      normalizeGeneratedArtifactKinds(attachmentConfig.artifactKinds).forEach((artifactKind) => {
        if (!expectedKinds.includes(artifactKind)) {
          expectedKinds.push(artifactKind);
        }
      });
    });

    return expectedKinds;
  }

  function getExtractionExpression(pattern) {
    const normalizedPattern =
      pattern?.trim() || CONFIG.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
    const regexLiteralMatch = normalizedPattern.match(/^\/([\\s\\S]*)\/([a-z]*)$/i);

    if (regexLiteralMatch) {
      const [, source, flags] = regexLiteralMatch;
      const finalFlags = flags.includes("s") ? flags : `${flags}s`;
      return new RegExp(source, finalFlags);
    }

    return new RegExp(normalizedPattern, "s");
  }

  function extractTextFromAnswer(answer, pattern) {
    const match = getExtractionExpression(pattern).exec(answer || "");
    if (!match) {
      return "";
    }

    return String(match[1] ?? match[0] ?? "").trim();
  }

  function normalizeSelectedAttachments(value) {
    const maxFilesPerStep = CONFIG?.ATTACHMENTS?.MAX_FILES_PER_STEP || 10;
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry === "string" && entry.trim()) {
          return {
            attachmentId: entry.trim(),
            name: entry.trim(),
            relativePath: "",
            mimeType: "application/octet-stream",
            sizeBytes: 0
          };
        }

        if (!entry || typeof entry !== "object") {
          return null;
        }

        const attachmentId = typeof entry.attachmentId === "string" ? entry.attachmentId.trim() : "";
        if (!attachmentId) {
          return null;
        }

        return {
          attachmentId,
          name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : attachmentId,
          relativePath: typeof entry.relativePath === "string" ? entry.relativePath.trim() : "",
          mimeType: typeof entry.mimeType === "string" && entry.mimeType.trim()
            ? entry.mimeType.trim()
            : "application/octet-stream",
          sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Math.max(0, Number(entry.sizeBytes)) : 0
        };
      })
      .filter(Boolean)
      .slice(0, maxFilesPerStep);
  }

  function normalizeGeneratedArtifactKinds(value) {
    const fallback = ["prompts_file", "scripts_file"];
    if (!Array.isArray(value)) {
      return fallback;
    }

    const uniqueKinds = [];
    value.forEach((entry) => {
      const normalized = typeof entry === "string" ? entry.trim() : "";
      if (!GENERATED_ATTACHMENT_KIND_SET.has(normalized) || uniqueKinds.includes(normalized)) {
        return;
      }
      uniqueKinds.push(normalized);
    });

    return uniqueKinds.length > 0 ? uniqueKinds : fallback;
  }

  function normalizeGeneratedSourceStepIndex(value, stepIndex) {
    if (stepIndex <= 0) {
      return -1;
    }

    const fallback = stepIndex - 1;
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) {
      return fallback;
    }

    return Math.min(stepIndex - 1, Math.max(0, numeric));
  }

  function normalizeGeneratedArtifactDescriptor(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const attachmentId = typeof value.attachmentId === "string" ? value.attachmentId.trim() : "";
    if (!attachmentId) {
      return null;
    }

    return {
      attachmentId,
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : attachmentId,
      relativePath: typeof value.relativePath === "string" ? value.relativePath.trim() : "",
      mimeType: typeof value.mimeType === "string" && value.mimeType.trim()
        ? value.mimeType.trim()
        : "application/octet-stream",
      sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Math.max(0, Number(value.sizeBytes)) : 0,
      downloadUrl: typeof value.downloadUrl === "string" ? value.downloadUrl.trim() : "",
      artifactKind: typeof value.artifactKind === "string" ? value.artifactKind.trim() : "",
      workflowRunId: typeof value.workflowRunId === "string" ? value.workflowRunId.trim() : "",
      sourceStepIndex: Number.isInteger(Number(value.sourceStepIndex)) ? Number(value.sourceStepIndex) : -1,
    };
  }

  function normalizeGeneratedArtifacts(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(normalizeGeneratedArtifactDescriptor).filter(Boolean);
  }

  function formatGeneratedArtifactKind(artifactKind) {
    return GENERATED_ATTACHMENT_LABELS[artifactKind] || artifactKind;
  }

  function resolveStepAttachments(step, stepIndex) {
    const attachmentConfig = step?.attachmentConfig || {};
    if (attachmentConfig.enabled !== true) {
      return { attachments: [], mode: "none", sourceStepIndex: -1, missingKinds: [] };
    }

    if (attachmentConfig.mode !== "generated") {
      return {
        attachments: [...(step.attachmentConfig?.selectedAttachments || [])],
        mode: "static",
        sourceStepIndex: -1,
        missingKinds: []
      };
    }

    const sourceStepIndex = Number.isInteger(attachmentConfig.sourceStepIndex)
      ? attachmentConfig.sourceStepIndex
      : stepIndex - 1;
    if (sourceStepIndex < 0 || sourceStepIndex >= stepIndex) {
      return {
        attachments: [],
        mode: "generated",
        sourceStepIndex,
        missingKinds: [],
        error: "Los adjuntos generados deben apuntar a un step previo."
      };
    }

    const expectedKinds = normalizeGeneratedArtifactKinds(attachmentConfig.artifactKinds);
    const workflowRunId = typeof runtimeState.workflowContext?.runId === "string"
      ? runtimeState.workflowContext.runId.trim()
      : "";
    const sourceArtifacts = Array.isArray(runtimeState.workflowContext?.generatedArtifacts?.[sourceStepIndex])
      ? runtimeState.workflowContext.generatedArtifacts[sourceStepIndex]
      : [];
    const availableArtifacts = sourceArtifacts
      .map(normalizeGeneratedArtifactDescriptor)
      .filter(Boolean)
      .filter((artifact) => !workflowRunId || !artifact.workflowRunId || artifact.workflowRunId === workflowRunId);

    const attachments = [];
    const missingKinds = [];
    expectedKinds.forEach((artifactKind) => {
      const artifact = availableArtifacts.find((entry) => entry.artifactKind === artifactKind);
      if (artifact) {
        attachments.push(artifact);
        return;
      }
      missingKinds.push(artifactKind);
    });

    if (attachmentConfig.required !== false && missingKinds.length > 0) {
      return {
        attachments: [],
        mode: "generated",
        sourceStepIndex,
        missingKinds,
        error: `Faltan artefactos generados del step ${sourceStepIndex + 1}: ${missingKinds
          .map(formatGeneratedArtifactKind)
          .join(", ")}`
      };
    }

    return {
      attachments,
      mode: "generated",
      sourceStepIndex,
      missingKinds
    };
  }

  function normalizeWorkflows(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const defaultRegex = CONFIG.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
    const defaultPlaceholder = CONFIG.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";
    const antiBotDefaults = CONFIG.ANTI_BOT || {};

    return value
      .filter((workflow) => workflow && typeof workflow === "object")
      .map((workflow, workflowIndex) => {
        const steps = Array.isArray(workflow.steps)
          ? workflow.steps
              .filter((step) => step && typeof step === "object")
              .map((step, stepIndex) => {
                const validActions = ["extract", "store_full", "none"];
                const responseAction = validActions.includes(step.chainConfig?.responseAction)
                  ? step.chainConfig.responseAction
                  : "none";

                const externalSource = {
                  enabled: step.chainConfig?.externalSource?.enabled === true,
                  url:
                    typeof step.chainConfig?.externalSource?.url === "string" &&
                    step.chainConfig.externalSource.url.trim()
                      ? step.chainConfig.externalSource.url.trim()
                      : CONFIG?.REMOTE_API?.BEST_TITLE_URL || "http://localhost:7788/api/extensions/autoyemini/best-title",
                  placeholder:
                    typeof step.chainConfig?.externalSource?.placeholder === "string" &&
                    step.chainConfig.externalSource.placeholder.trim()
                      ? step.chainConfig.externalSource.placeholder.trim()
                      : "{{clusiv_title}}"
                };
                const attachmentConfig = {
                  enabled: step.attachmentConfig?.enabled === true,
                  mode: stepIndex > 0 && step.attachmentConfig?.mode === "generated" ? "generated" : "static",
                  selectedAttachments: normalizeSelectedAttachments(step.attachmentConfig?.selectedAttachments),
                  sourceStepIndex: normalizeGeneratedSourceStepIndex(step.attachmentConfig?.sourceStepIndex, stepIndex),
                  artifactKinds: normalizeGeneratedArtifactKinds(step.attachmentConfig?.artifactKinds),
                  required: step.attachmentConfig?.required !== false
                };

                const rawAntiBot = step.antiBotConfig && typeof step.antiBotConfig === "object"
                  ? step.antiBotConfig
                  : {};

                return {
                  id: String(step.id || SharedUtils.generateUUID()),
                  title: String(step.title || `Step ${stepIndex + 1}`).trim(),
                  content: typeof step.content === "string" ? step.content : "",
                  order: typeof step.order === "number" ? step.order : stepIndex,
                  chainConfig: {
                    responseAction,
                    extractionRegex:
                      typeof step.chainConfig?.extractionRegex === "string" && step.chainConfig.extractionRegex.trim()
                        ? step.chainConfig.extractionRegex
                        : defaultRegex,
                    injectionPlaceholder:
                      typeof step.chainConfig?.injectionPlaceholder === "string" && step.chainConfig.injectionPlaceholder.trim()
                        ? step.chainConfig.injectionPlaceholder
                        : defaultPlaceholder,
                    externalSource
                  },
                  attachmentConfig,
                  antiBotConfig: {
                    humanTyping: rawAntiBot.humanTyping !== false,
                    randomDelays: rawAntiBot.randomDelays !== false,
                    biologicalPauses: rawAntiBot.biologicalPauses === true,
                    typingSpeed: Array.isArray(rawAntiBot.typingSpeed) && rawAntiBot.typingSpeed.length === 2
                      ? [...rawAntiBot.typingSpeed]
                      : [...(antiBotDefaults.TYPING_SPEED_MS || [30, 100])],
                    fatigueCount: rawAntiBot.fatigueCount ?? antiBotDefaults.FATIGUE_AFTER_QUESTIONS ?? 10,
                    fatigueMinMinutes: rawAntiBot.fatigueMinMinutes ?? 0.5,
                    fatigueMaxMinutes: rawAntiBot.fatigueMaxMinutes ?? 1
                  }
                };
              })
              .sort((a, b) => a.order - b.order)
          : [];

        return {
          id: String(workflow.id || `workflow-${workflowIndex + 1}`),
          name: String(workflow.name || `Workflow ${workflowIndex + 1}`).trim(),
          steps,
          hasExternalTitleSource: steps[0]?.chainConfig?.externalSource?.enabled === true
        };
      });
  }

  async function loadWorkflows() {
    const stored = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.WORKFLOWS]);
    return normalizeWorkflows(stored[CONFIG.STORAGE_KEYS.WORKFLOWS]);
  }

  async function listWorkflows() {
    const workflows = await loadWorkflows();
    return workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      stepsCount: workflow.steps.length,
      hasExternalTitleSource: workflow.hasExternalTitleSource === true
    }));
  }

  async function ensureChatGPTReady(settings) {
    const tab = await findOrCreateChatGPTTab(settings.useTempChat !== false, settings.keepSameChat === true);

    let ready = await waitForContentScript(tab.id);
    if (!ready) {
      await chrome.tabs.reload(tab.id);
      await SharedUtils.sleep(CONFIG.TIMING.SSE_READY_WAIT_MS);
      await waitForTabLoad(tab.id);
      ready = await waitForContentScript(tab.id);
    }

    if (!ready) {
      throw new Error(
        "Content script no listo incluso después de refrescar Google AI Studio. Refresca la página manualmente (F5)."
      );
    }

    return tab;
  }

  function buildQuestionPayload(step, chainedText, attachments) {
    const extSource = step.chainConfig?.externalSource || {};
    const placeholder = extSource.enabled === true && extSource.placeholder && runtimeState.stepIndex === 0
      ? extSource.placeholder
      : step.chainConfig?.injectionPlaceholder || CONFIG.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";

    let content = step.content || "";
    if (chainedText && placeholder) {
      content = content.split(placeholder).join(chainedText);
    }

    return {
      id: SharedUtils.generateUUID(),
      question: content,
      attachments: Array.isArray(attachments) ? [...attachments] : [],
      extractionConfig: {
        extractionRegex: step.chainConfig?.extractionRegex || CONFIG.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>",
        injectionPlaceholder: step.chainConfig?.injectionPlaceholder || CONFIG.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}"
      }
    };
  }

  async function fetchExternalTitle(step) {
    const extSource = step.chainConfig?.externalSource || {};
    const response = await fetch(
      CONFIG?.REMOTE_API?.resolveBestTitleUrl?.(extSource.url)
        || CONFIG?.REMOTE_API?.BEST_TITLE_URL
        || "http://localhost:7788/api/extensions/autoyemini/best-title"
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al consultar el título externo.`);
    }

    const payload = await response.json();
    if (!payload.title || payload.status !== "ready") {
      throw new Error("No hay un título listo en clusiv-v5. Ejecuta primero Analisis.");
    }

    return String(payload.title || "");
  }

  function buildStepMessage(prefix, step, stepIndex) {
    return `${prefix} ${stepIndex + 1}: ${getStepDisplayName(step, stepIndex)}`;
  }

  async function advanceWorkflowStep(stepIndex) {
    if (!runtimeState.isRunning || !runtimeState.workflow) {
      return;
    }

    if (stepIndex >= runtimeState.workflow.steps.length) {
      await completeWorkflow();
      return;
    }

    const step = runtimeState.workflow.steps[stepIndex];
    runtimeState.stepIndex = stepIndex;

    notifyWorkflowStatus({
      status: "step_start",
      running: true,
      workflowId: runtimeState.workflowId,
      workflowName: runtimeState.workflowName,
      stepIndex,
      message: buildStepMessage("Iniciando step", step, stepIndex)
    });
    addRemoteLog(buildStepMessage("Iniciando step", step, stepIndex), "info");

    let chainedText = runtimeState.workflowContext?.chainedText || "";
    if (stepIndex === 0 && step.chainConfig?.externalSource?.enabled) {
      chainedText = await fetchExternalTitle(step);
      addRemoteLog(`Título externo recibido: "${chainedText}"`, "info");
    }

    const attachmentResolution = resolveStepAttachments(step, stepIndex);
    if (attachmentResolution.error) {
      throw new Error(attachmentResolution.error);
    }
    if (attachmentResolution.mode === "generated") {
      addRemoteLog(
        `Adjuntos dinámicos resueltos desde step ${attachmentResolution.sourceStepIndex + 1}: ${attachmentResolution.attachments.length}.`,
        "info"
      );
      if (attachmentResolution.missingKinds.length > 0) {
        addRemoteLog(
          `Artefactos opcionales no encontrados: ${attachmentResolution.missingKinds
            .map(formatGeneratedArtifactKind)
            .join(", ")}.`,
          "warning"
        );
      }
    }

    const questionPayload = buildQuestionPayload(step, chainedText, attachmentResolution.attachments);
    const tab = await ensureChatGPTReady(runtimeState.settings);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "ASK_QUESTION",
      question: questionPayload.question,
      questionId: questionPayload.id,
      attachments: questionPayload.attachments,
      useTempChat: runtimeState.settings.useTempChat !== false,
      useWebSearch: runtimeState.settings.useWebSearch !== false,
      antiBotConfig: step.antiBotConfig || null
    });

    if (!result?.success) {
      throw new Error(result?.error || "No se pudo enviar el step a ChatGPT.");
    }

    runtimeState.pendingQuestion = {
      id: questionPayload.id,
      stepIndex,
      step,
      question: questionPayload.question
    };

    notifyWorkflowStatus({
      status: "question_submitted",
      running: true,
      workflowId: runtimeState.workflowId,
      workflowName: runtimeState.workflowName,
      stepIndex,
      message: buildStepMessage("Step enviado a ChatGPT", step, stepIndex)
    });
  }

  async function persistStoredResponse(step, stepIndex, answer) {
    const storedStepIndexes = getStoredStepIndexes(runtimeState.workflow);
    const totalStoredSteps = storedStepIndexes.length;
    const isLastStoredStep = storedStepIndexes[storedStepIndexes.length - 1] === stepIndex;
    const expectedGeneratedArtifactKinds = getExpectedGeneratedArtifactKindsForStep(
      runtimeState.workflow,
      stepIndex
    );

    const response = await fetch(
      CONFIG?.REMOTE_API?.SAVE_STEP_RESPONSE_URL || "http://localhost:7788/api/extensions/autoyemini/save-step-response",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowName: runtimeState.workflowName,
          stepTitle: step?.title || `step_${stepIndex}`,
          stepIndex,
          totalStoredSteps,
          totalSteps: totalStoredSteps,
          isLastStoredStep,
          isLastStep: isLastStoredStep,
          workflowRunId: runtimeState.workflowContext?.runId || "",
          expectedGeneratedArtifactKinds,
          answer,
          timestamp: Date.now()
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al guardar la respuesta del step.`);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || "La app rechazó guardar la respuesta del step.");
    }

    addRemoteLog(`Respuesta guardada en: ${payload.path}`, "success");
    return payload;
  }

  async function applyStepResult(step, stepIndex, result) {
    const responseAction = step.chainConfig?.responseAction || "none";
    const ctx = { ...runtimeState.workflowContext };
    ctx.stepResults = [...(ctx.stepResults || [])];

    if (responseAction === "extract") {
      const extractedText = extractTextFromAnswer(
        result.answer || "",
        step.chainConfig?.extractionRegex || CONFIG.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>"
      );
      if (!extractedText) {
        throw new Error("No se pudo extraer texto del step actual con la regex configurada.");
      }

      ctx.chainedText = extractedText;
      ctx.stepResults.push({ stepIndex, action: "extract", text: extractedText, success: true });
      runtimeState.workflowContext = ctx;
      addRemoteLog(`Texto extraído para el siguiente step (${extractedText.length} chars).`, "success");
      return;
    }

    if (responseAction === "store_full") {
      const fullResponse = result.answer || "";
      ctx.chainedText = fullResponse;
      ctx.stepResults.push({
        stepIndex,
        action: "store_full",
        text: fullResponse.substring(0, 200),
        success: true
      });
      ctx.generatedArtifacts = { ...(ctx.generatedArtifacts || {}) };
      runtimeState.workflowContext = ctx;
      const savePayload = await persistStoredResponse(step, stepIndex, fullResponse);
      ctx.generatedArtifacts[stepIndex] = normalizeGeneratedArtifacts(savePayload.generatedArtifacts);
      if (!ctx.runId && typeof savePayload.workflowRunId === "string") {
        ctx.runId = savePayload.workflowRunId.trim();
      }
      runtimeState.workflowContext = ctx;
      addRemoteLog(
        `Diagnóstico artefactos: escenas=${savePayload.sceneBlocksCount || 0}, prompts=${savePayload.parsedPromptsCount || 0}, scripts=${savePayload.parsedScriptsCount || 0}, generados=${savePayload.generatedArtifactsCount || 0}.`,
        "info"
      );
      if (typeof savePayload.generatedArtifactsError === "string" && savePayload.generatedArtifactsError.trim()) {
        addRemoteLog(`Advertencia de artefactos: ${savePayload.generatedArtifactsError.trim()}`, "warning");
      }
      if (ctx.generatedArtifacts[stepIndex].length > 0) {
        addRemoteLog(
          `Artefactos listos para próximos steps: ${ctx.generatedArtifacts[stepIndex]
            .map((artifact) => artifact.name || artifact.artifactKind)
            .join(", ")}.`,
          "success"
        );
      }
      return;
    }

    ctx.stepResults.push({ stepIndex, action: "none", text: "", success: true });
    runtimeState.workflowContext = ctx;
  }

  async function completeWorkflow() {
    const workflow = runtimeState.workflow;
    const workflowId = runtimeState.workflowId;
    const workflowName = runtimeState.workflowName;
    const totalStoredSteps = countStoredSteps(workflow);
    let message = `Workflow ${workflowName} completado.`;

    if (totalStoredSteps > 0) {
      try {
        const response = await fetch(
          CONFIG?.REMOTE_API?.WORKFLOW_COMPLETE_URL || "http://localhost:7788/api/extensions/autoyemini/workflow-complete",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowName,
              totalStoredSteps,
              totalSteps: totalStoredSteps,
              workflowRunId: runtimeState.workflowContext?.runId || ""
            })
          }
        );
        const payload = await response.json();
        if (response.ok && payload.success) {
          message = `Workflow ${workflowName} completado. Script guardado en: ${payload.path}`;
        } else if (payload?.error) {
          message = `Workflow ${workflowName} completado, pero no se pudo generar el script: ${payload.error}`;
        }
      } catch (error) {
        message = `Workflow ${workflowName} completado, pero falló la notificación final a clusiv-v5: ${error.message}`;
      }
    }

    notifyWorkflowStatus({
      status: "completed",
      running: false,
      workflowId,
      workflowName,
      stepIndex: runtimeState.stepIndex,
      message
    });
    addRemoteLog(message, "success");
    resetRuntimeState();
  }

  async function abortWorkflow(message) {
    const workflowId = runtimeState.workflowId;
    const workflowName = runtimeState.workflowName;

    notifyWorkflowStatus({
      status: "error",
      running: false,
      workflowId,
      workflowName,
      stepIndex: runtimeState.stepIndex,
      message
    });
    addRemoteLog(message, "error");
    resetRuntimeState();
  }

  async function runWorkflow(workflowId) {
    if (runtimeState.isRunning) {
      return {
        ok: false,
        workflowId: runtimeState.workflowId,
        workflowName: runtimeState.workflowName,
        message: "Ya hay un workflow remoto en ejecución.",
        status: "busy",
        stepIndex: runtimeState.stepIndex
      };
    }

    const workflows = await loadWorkflows();
    const workflow = workflows.find((entry) => entry.id === workflowId);
    if (!workflow) {
      return { ok: false, message: "Workflow remoto no encontrado.", status: "error", stepIndex: -1 };
    }
    if (workflow.steps.length === 0) {
      return { ok: false, message: "El workflow remoto no tiene steps.", status: "error", stepIndex: -1 };
    }

    runtimeState.settings = await loadRunnerSettings();
    runtimeState.isRunning = true;
    runtimeState.workflow = workflow;
    runtimeState.workflowId = workflow.id;
    runtimeState.workflowName = workflow.name;
    runtimeState.stepIndex = -1;
    runtimeState.pendingQuestion = null;
    runtimeState.workflowContext = {
      runId: SharedUtils.generateUUID(),
      chainedText: "",
      stepResults: [],
      generatedArtifacts: {}
    };

    notifyWorkflowStatus({
      status: "queued",
      running: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepIndex: -1,
      message: `Workflow ${workflow.name} encolado.`
    });

    void advanceWorkflowStep(0).catch((error) => {
      void abortWorkflow(error.message || "Falló la ejecución remota del workflow.");
    });

    return {
      ok: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      message: `Workflow ${workflow.name} encolado.`,
      status: "queued",
      stepIndex: -1
    };
  }

  async function handleQuestionComplete(result) {
    if (!runtimeState.isRunning || !runtimeState.pendingQuestion) {
      return false;
    }

    if (result?.questionId !== runtimeState.pendingQuestion.id) {
      return false;
    }

    const { step, stepIndex } = runtimeState.pendingQuestion;
    runtimeState.pendingQuestion = null;

    if (!result?.success) {
      await abortWorkflow(
        `Falló el step ${stepIndex + 1} (${getStepDisplayName(step, stepIndex)}): ${result?.error || "sin detalle"}`
      );
      return true;
    }

    try {
      await applyStepResult(step, stepIndex, result);
      notifyWorkflowStatus({
        status: "step_complete",
        running: true,
        workflowId: runtimeState.workflowId,
        workflowName: runtimeState.workflowName,
        stepIndex,
        message: buildStepMessage("Step completado", step, stepIndex)
      });
      addRemoteLog(buildStepMessage("Step completado", step, stepIndex), "success");
      await advanceWorkflowStep(stepIndex + 1);
    } catch (error) {
      await abortWorkflow(error.message || "Falló el procesamiento del resultado del workflow remoto.");
    }

    return true;
  }

  globalThis.ChatGPTRemoteRuntime = {
    listWorkflows,
    runWorkflow,
    handleQuestionComplete,
    isRunning() {
      return runtimeState.isRunning;
    },
    getState() {
      return {
        isRunning: runtimeState.isRunning,
        workflowId: runtimeState.workflowId,
        workflowName: runtimeState.workflowName,
        stepIndex: runtimeState.stepIndex
      };
    }
  };
})();