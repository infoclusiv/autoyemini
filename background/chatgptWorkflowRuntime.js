(function registerChatGPTRemoteRuntime() {
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
                  selectedAttachments: normalizeSelectedAttachments(step.attachmentConfig?.selectedAttachments)
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

  function buildQuestionPayload(step, chainedText) {
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
      attachments: step.attachmentConfig?.enabled === true
        ? [...(step.attachmentConfig.selectedAttachments || [])]
        : [],
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

    const questionPayload = buildQuestionPayload(step, chainedText);
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
      runtimeState.workflowContext = ctx;
      await persistStoredResponse(step, stepIndex, fullResponse);
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
              totalSteps: totalStoredSteps
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
      chainedText: "",
      stepResults: []
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