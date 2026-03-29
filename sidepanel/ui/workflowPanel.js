import { AppState } from "../state/appState.js";
import { saveWorkflows, StorageKeys } from "../services/storageService.js";
import { t } from "../i18n/i18n.js";

const { generateUUID } = globalThis.SharedUtils;

export class WorkflowPanel {
  constructor({ containerElement, addLog, onStartWorkflow }) {
    this.container = containerElement;
    this.addLog = addLog;
    this.onStartWorkflow = onStartWorkflow;
    this.pendingSelectedWorkflowId = "";

    this.selectElement = this.container.querySelector("#workflowSelect");
    this.saveButton = this.container.querySelector("#saveWorkflowBtn");
    this.renameButton = this.container.querySelector("#renameWorkflowBtn");
    this.deleteButton = this.container.querySelector("#deleteWorkflowBtn");
    this.addStepButton = this.container.querySelector("#addWorkflowStepBtn");
    this.stepTemplateSelect = this.container.querySelector("#stepTemplateSelect");
    this.stepsListElement = this.container.querySelector("#workflowStepsList");
    this.startWorkflowButton = this.container.querySelector("#startWorkflowBtn");

    this.saveButton.addEventListener("click", () => {
      void this.handleSave();
    });
    this.renameButton.addEventListener("click", () => {
      void this.handleRename();
    });
    this.deleteButton.addEventListener("click", () => {
      void this.handleDelete();
    });
    this.addStepButton.addEventListener("click", () => {
      void this.handleAddStep();
    });
    this.startWorkflowButton.addEventListener("click", () => {
      if (this.onStartWorkflow) {
        this.onStartWorkflow();
      }
    });
    this.selectElement.addEventListener("change", () => {
      this.renderSteps();
    });

    AppState.subscribe((state, changedKeys) => {
      if (changedKeys.includes("workflows")) {
        this.renderSelect(state.workflows);
      }
      if (changedKeys.includes("templates")) {
        this.renderStepTemplateSelect(state.templates);
        this.renderSteps();
      }
      if (changedKeys.includes("activeWorkflow") || changedKeys.includes("activeWorkflowStepIndex")) {
        this.renderSteps();
      }
    });

    this.renderSelect(AppState.getState().workflows);
    this.renderStepTemplateSelect(AppState.getState().templates);
  }

  getSelectedWorkflow() {
    const selectedId = this.selectElement.value;
    if (!selectedId) {
      return null;
    }
    return AppState.getState().workflows.find((wf) => wf.id === selectedId) || null;
  }

  renderSelect(workflows = AppState.getState().workflows) {
    const preferredValue = this.pendingSelectedWorkflowId || this.selectElement.value;
    this.selectElement.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("workflow.selectDefault");
    this.selectElement.appendChild(defaultOption);

    workflows.forEach((wf) => {
      const option = document.createElement("option");
      option.value = wf.id;
      option.textContent = `${wf.name} (${wf.steps.length})`;
      this.selectElement.appendChild(option);
    });

    if (preferredValue && workflows.some((wf) => wf.id === preferredValue)) {
      this.selectElement.value = preferredValue;
    }

    this.pendingSelectedWorkflowId = "";
    this.renderSteps();
  }

  renderStepTemplateSelect(templates = AppState.getState().templates) {
    this.stepTemplateSelect.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("workflow.selectTemplate");
    this.stepTemplateSelect.appendChild(defaultOption);

    templates.forEach((tpl) => {
      const option = document.createElement("option");
      option.value = tpl.id;
      option.textContent = tpl.name;
      this.stepTemplateSelect.appendChild(option);
    });
  }

  renderSteps() {
    const workflow = this.getSelectedWorkflow();
    this.stepsListElement.innerHTML = "";

    if (!workflow || workflow.steps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "workflow-empty-steps";
      empty.textContent = workflow ? t("workflow.noSteps") : "";
      this.stepsListElement.appendChild(empty);
      return;
    }

    const state = AppState.getState();
    const templates = state.templates;
    const isActiveWorkflow = state.activeWorkflow && state.activeWorkflow.id === workflow.id;

    workflow.steps.forEach((step, index) => {
      const template = templates.find((tpl) => tpl.id === step.templateId);

      // Connector arrow between steps
      if (index > 0) {
        const connector = document.createElement("div");
        connector.className = "workflow-step-connector";

        const prevStep = workflow.steps[index - 1];
        const prevAction = prevStep.chainConfig?.responseAction || "none";
        if (prevAction === "extract" || prevAction === "store_full") {
          connector.classList.add("workflow-step-connector-active");
          connector.innerHTML = '<span class="connector-icon">🔗</span>';
        } else {
          connector.innerHTML = '<span class="connector-icon">↓</span>';
        }

        this.stepsListElement.appendChild(connector);
      }

      const stepEl = document.createElement("div");
      stepEl.className = "workflow-step";

      if (isActiveWorkflow && state.activeWorkflowStepIndex === index) {
        stepEl.classList.add("workflow-step-active");
      }
      if (isActiveWorkflow && index < state.activeWorkflowStepIndex) {
        stepEl.classList.add("workflow-step-done");
      }
      if (!template) {
        stepEl.classList.add("workflow-step-invalid");
      }

      // Step header row
      const stepHeader = document.createElement("div");
      stepHeader.className = "workflow-step-header";

      const stepLabel = document.createElement("span");
      stepLabel.className = "workflow-step-label";
      stepLabel.textContent = t("workflow.stepLabel", { num: index + 1 });

      const stepName = document.createElement("span");
      stepName.className = "workflow-step-name";
      stepName.textContent = template ? template.name : "⚠️ ?";

      const actions = document.createElement("span");
      actions.className = "workflow-step-actions";

      if (index > 0) {
        const upBtn = document.createElement("button");
        upBtn.className = "workflow-step-btn";
        upBtn.textContent = "↑";
        upBtn.title = "Move up";
        upBtn.addEventListener("click", () => {
          void this.moveStep(workflow.id, index, index - 1);
        });
        actions.appendChild(upBtn);
      }

      if (index < workflow.steps.length - 1) {
        const downBtn = document.createElement("button");
        downBtn.className = "workflow-step-btn";
        downBtn.textContent = "↓";
        downBtn.title = "Move down";
        downBtn.addEventListener("click", () => {
          void this.moveStep(workflow.id, index, index + 1);
        });
        actions.appendChild(downBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.className = "workflow-step-btn workflow-step-btn-remove";
      removeBtn.textContent = "✕";
      removeBtn.title = t("workflow.removeStep");
      removeBtn.addEventListener("click", () => {
        void this.removeStep(workflow.id, index);
      });
      actions.appendChild(removeBtn);

      stepHeader.appendChild(stepLabel);
      stepHeader.appendChild(stepName);
      stepHeader.appendChild(actions);

      // Chain config row
      const chainRow = document.createElement("div");
      chainRow.className = "workflow-step-chain-row";

      const actionLabel = document.createElement("span");
      actionLabel.className = "workflow-step-chain-label";
      actionLabel.textContent = "Response:";

      const actionSelect = document.createElement("select");
      actionSelect.className = "workflow-step-action-select";

      const actionOptions = [
        { value: "none", label: "⏭️ Skip", cls: "action-none" },
        { value: "extract", label: "🔍 Extract (regex)", cls: "action-extract" },
        { value: "store_full", label: "📋 Store Full", cls: "action-store" }
      ];

      actionOptions.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        actionSelect.appendChild(option);
      });

      const currentAction = step.chainConfig?.responseAction || "none";
      actionSelect.value = currentAction;

      actionSelect.addEventListener("change", () => {
        void this.updateStepChainConfig(workflow.id, index, actionSelect.value);
      });

      // Action badge
      const actionBadge = document.createElement("span");
      actionBadge.className = `workflow-step-action-badge action-badge-${currentAction}`;
      if (currentAction === "extract") {
        actionBadge.textContent = "🔍 Extracts data";
      } else if (currentAction === "store_full") {
        actionBadge.textContent = "📋 Stores response";
      } else {
        actionBadge.textContent = "⏭️ Passes through";
      }

      // Input indicator (if template content contains the injection placeholder)
      const injectionPlaceholder = state.injectionPlaceholder || "{{extract}}";
      const hasInjection = template && template.content && template.content.includes(injectionPlaceholder);

      chainRow.appendChild(actionLabel);
      chainRow.appendChild(actionSelect);

      stepEl.appendChild(stepHeader);
      stepEl.appendChild(chainRow);

      if (hasInjection) {
        const inputIndicator = document.createElement("div");
        inputIndicator.className = "workflow-step-input-indicator";
        inputIndicator.textContent = `📥 Receives data via ${injectionPlaceholder}`;
        stepEl.appendChild(inputIndicator);
      }

      stepEl.appendChild(actionBadge);

      this.stepsListElement.appendChild(stepEl);
    });
  }

  async persistWorkflows(nextWorkflows, selectedWorkflowId) {
    this.pendingSelectedWorkflowId = selectedWorkflowId || "";
    AppState.patch({ workflows: nextWorkflows });
    await saveWorkflows(nextWorkflows);
  }

  async handleSave() {
    const workflowName = window.prompt(t("workflow.namePrompt"), "");
    if (workflowName === null) {
      return;
    }

    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      this.addLog(t("messages.workflowNameRequired"), "warning");
      return;
    }

    const workflow = {
      id: generateUUID(),
      name: trimmedName,
      steps: []
    };

    const nextWorkflows = [...AppState.getState().workflows, workflow];
    await this.persistWorkflows(nextWorkflows, workflow.id);
    this.addLog(t("messages.workflowSaved"), "success");
  }

  async handleRename() {
    const workflow = this.getSelectedWorkflow();
    if (!workflow) {
      this.addLog(t("messages.workflowSelectRequired"), "warning");
      return;
    }

    const newName = window.prompt(t("workflow.renamePrompt"), workflow.name);
    if (newName === null) {
      return;
    }

    const trimmedName = newName.trim();
    if (!trimmedName) {
      this.addLog(t("messages.workflowNameRequired"), "warning");
      return;
    }

    const nextWorkflows = AppState.getState().workflows.map((wf) => {
      if (wf.id !== workflow.id) {
        return wf;
      }
      return { ...wf, name: trimmedName };
    });

    await this.persistWorkflows(nextWorkflows, workflow.id);
    this.addLog(t("messages.workflowRenamed"), "success");
  }

  async handleDelete() {
    const workflow = this.getSelectedWorkflow();
    if (!workflow) {
      this.addLog(t("messages.workflowSelectRequired"), "warning");
      return;
    }

    if (!window.confirm(t("messages.confirmWorkflowDelete"))) {
      return;
    }

    const nextWorkflows = AppState.getState().workflows.filter((wf) => wf.id !== workflow.id);
    await this.persistWorkflows(nextWorkflows, "");
    this.addLog(t("messages.workflowDeleted"), "info");
  }

  async handleAddStep() {
    const workflow = this.getSelectedWorkflow();
    if (!workflow) {
      this.addLog(t("messages.workflowSelectRequired"), "warning");
      return;
    }

    const templateId = this.stepTemplateSelect.value;
    if (!templateId) {
      return;
    }

    const newStep = {
      templateId,
      order: workflow.steps.length,
      chainConfig: { responseAction: "none" }
    };

    const nextWorkflows = AppState.getState().workflows.map((wf) => {
      if (wf.id !== workflow.id) {
        return wf;
      }
      return { ...wf, steps: [...wf.steps, newStep] };
    });

    await this.persistWorkflows(nextWorkflows, workflow.id);
    this.stepTemplateSelect.value = "";
  }

  async removeStep(workflowId, stepIndex) {
    const nextWorkflows = AppState.getState().workflows.map((wf) => {
      if (wf.id !== workflowId) {
        return wf;
      }
      const nextSteps = wf.steps
        .filter((_, i) => i !== stepIndex)
        .map((step, i) => ({ ...step, order: i }));
      return { ...wf, steps: nextSteps };
    });

    await this.persistWorkflows(nextWorkflows, workflowId);
  }

  async moveStep(workflowId, fromIndex, toIndex) {
    const nextWorkflows = AppState.getState().workflows.map((wf) => {
      if (wf.id !== workflowId) {
        return wf;
      }
      const nextSteps = [...wf.steps];
      const [moved] = nextSteps.splice(fromIndex, 1);
      nextSteps.splice(toIndex, 0, moved);
      return {
        ...wf,
        steps: nextSteps.map((step, i) => ({ ...step, order: i }))
      };
    });

    await this.persistWorkflows(nextWorkflows, workflowId);
  }

  async updateStepChainConfig(workflowId, stepIndex, responseAction) {
    const nextWorkflows = AppState.getState().workflows.map((wf) => {
      if (wf.id !== workflowId) {
        return wf;
      }
      const nextSteps = wf.steps.map((step, i) => {
        if (i !== stepIndex) {
          return step;
        }
        return {
          ...step,
          chainConfig: { responseAction }
        };
      });
      return { ...wf, steps: nextSteps };
    });

    await this.persistWorkflows(nextWorkflows, workflowId);
  }
}
