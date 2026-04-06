export function getStoredStepIndexes(workflow) {
  if (!workflow || !Array.isArray(workflow.steps)) {
    return [];
  }

  return workflow.steps.reduce((indexes, step, stepIndex) => {
    if (step?.chainConfig?.responseAction === "store_full") {
      indexes.push(stepIndex);
    }
    return indexes;
  }, []);
}

export function countStoredSteps(workflow) {
  return getStoredStepIndexes(workflow).length;
}

export function normalizeWorkflows(value, existingTemplates) {
  if (!Array.isArray(value)) {
    return [];
  }

  // existingTemplates kept for signature compatibility; no longer used internally

  return value
    .filter((wf) => wf && typeof wf === "object")
    .map((wf, index) => {
      const steps = Array.isArray(wf.steps)
        ? wf.steps
            .filter((step) => step && typeof step === "object")
            .map((step, stepIndex) => {
              const validActions = ["extract", "store_full", "none"];
              const rawAction = step.chainConfig?.responseAction;
              const responseAction = validActions.includes(rawAction) ? rawAction : "none";

              const defaultRegex =
                globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
              const defaultPlaceholder =
                globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";

              const extractionRegex =
                typeof step.chainConfig?.extractionRegex === "string" &&
                step.chainConfig.extractionRegex.trim()
                  ? step.chainConfig.extractionRegex
                  : defaultRegex;

              const injectionPlaceholder =
                typeof step.chainConfig?.injectionPlaceholder === "string" &&
                step.chainConfig.injectionPlaceholder.trim()
                  ? step.chainConfig.injectionPlaceholder
                  : defaultPlaceholder;

              // ── externalSource config (step 0 external injection) ──
              const rawExtSrc = step.chainConfig?.externalSource;
              const externalSource = {
                enabled: rawExtSrc?.enabled === true,
                url:
                  typeof rawExtSrc?.url === "string" && rawExtSrc.url.trim()
                    ? rawExtSrc.url.trim()
                    : "http://localhost:7788/api/best-title",
                placeholder:
                  typeof rawExtSrc?.placeholder === "string" && rawExtSrc.placeholder.trim()
                    ? rawExtSrc.placeholder.trim()
                    : "{{clusiv_title}}"
              };

              // ── antiBotConfig per step ──────────────────────────────
              const abDefaults = globalThis.CONFIG?.ANTI_BOT || {};
              const defaultTypingSpeed = Array.isArray(abDefaults.TYPING_SPEED_MS) ? abDefaults.TYPING_SPEED_MS : [30, 100];
              const defaultFatiguePauseMs = Array.isArray(abDefaults.FATIGUE_PAUSE_MS) ? abDefaults.FATIGUE_PAUSE_MS : [20000, 40000];
              const defaultFatigueCount = typeof abDefaults.FATIGUE_AFTER_QUESTIONS === "number" ? abDefaults.FATIGUE_AFTER_QUESTIONS : 10;

              function msToMin(ms) {
                return Math.max(0.5, Math.round((Number(ms) / 60000) * 10) / 10);
              }

              const rawAb = step.antiBotConfig && typeof step.antiBotConfig === "object" ? step.antiBotConfig : {};

              const humanTyping = rawAb.humanTyping !== false;
              const randomDelays = rawAb.randomDelays !== false;
              const biologicalPauses = rawAb.biologicalPauses === true;

              const rawTypingSpeed = Array.isArray(rawAb.typingSpeed) && rawAb.typingSpeed.length === 2
                ? rawAb.typingSpeed
                : defaultTypingSpeed;
              const tsMin = Math.max(0, Number(rawTypingSpeed[0]) || defaultTypingSpeed[0]);
              const tsMax = Math.max(tsMin, Number(rawTypingSpeed[1]) || defaultTypingSpeed[1]);

              const fatigueCount = typeof rawAb.fatigueCount === "number" && rawAb.fatigueCount >= 1
                ? rawAb.fatigueCount
                : defaultFatigueCount;

              const fatigueMinMinutes = typeof rawAb.fatigueMinMinutes === "number" && rawAb.fatigueMinMinutes >= 0.5
                ? rawAb.fatigueMinMinutes
                : msToMin(defaultFatiguePauseMs[0]);

              const fatigueMaxMinutes = typeof rawAb.fatigueMaxMinutes === "number" && rawAb.fatigueMaxMinutes >= fatigueMinMinutes
                ? rawAb.fatigueMaxMinutes
                : Math.max(fatigueMinMinutes, msToMin(defaultFatiguePauseMs[1]));

              const antiBotConfig = {
                humanTyping,
                randomDelays,
                biologicalPauses,
                typingSpeed: [tsMin, tsMax],
                fatigueCount,
                fatigueMinMinutes,
                fatigueMaxMinutes
              };

              // Step id / title / content — new self-contained step model
              const stepId =
                typeof step.id === "string" && step.id.trim()
                  ? step.id
                  : (globalThis.SharedUtils?.generateUUID?.() || `step-${Date.now()}-${stepIndex}`);

              const stepTitle =
                typeof step.title === "string" && step.title.trim()
                  ? step.title.trim()
                  : `Step ${stepIndex + 1}`;

              const stepContent = typeof step.content === "string" ? step.content : "";
              const stepProvider =
                typeof step.provider === "string" && step.provider.trim()
                  ? step.provider.trim()
                  : "chatgpt";

              return {
                id: stepId,
                title: stepTitle,
                content: stepContent,
                provider: stepProvider,
                order: typeof step.order === "number" ? step.order : stepIndex,
                chainConfig: { responseAction, extractionRegex, injectionPlaceholder, externalSource },
                antiBotConfig
              };
            })
            .sort((a, b) => a.order - b.order)
            .map((step, sortedIndex) => ({
              ...step,
              order: sortedIndex
            }))
        : [];

      return {
        id: String(wf.id || `workflow-${index + 1}`),
        name: String(wf.name || `Workflow ${index + 1}`).trim(),
        steps
      };
    });
}
