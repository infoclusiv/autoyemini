export function normalizeWorkflows(value, existingTemplates) {
  if (!Array.isArray(value)) {
    return [];
  }

  const templateIds = new Set(
    (existingTemplates || []).map((t) => t.id)
  );

  return value
    .filter((wf) => wf && typeof wf === "object")
    .map((wf, index) => {
      const steps = Array.isArray(wf.steps)
        ? wf.steps
            .filter(
              (step) =>
                step &&
                typeof step === "object" &&
                typeof step.templateId === "string" &&
                templateIds.has(step.templateId)
            )
            .map((step, stepIndex) => {
              const validActions = ["extract", "store_full", "none"];
              const rawAction = step.chainConfig?.responseAction;
              const responseAction = validActions.includes(rawAction) ? rawAction : "none";

              return {
                templateId: step.templateId,
                order: typeof step.order === "number" ? step.order : stepIndex,
                chainConfig: { responseAction }
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
