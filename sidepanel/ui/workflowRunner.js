import { AppState } from "../state/appState.js";
import { t } from "../i18n/i18n.js";

export class WorkflowRunner {
  constructor({ containerElement, addLog, onStartWorkflow }) {
    this.container = containerElement;
    this.addLog = addLog;
    this.onStartWorkflow = onStartWorkflow;

    this.selectElement = this.container.querySelector("#workflowSelect");
    this.openEditorBtn = this.container.querySelector("#openWorkflowEditorBtn");
    this.startWorkflowButton = this.container.querySelector("#startWorkflowBtn");
    this.progressList = this.container.querySelector("#workflowProgressList");

    this.openEditorBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("workflow-editor.html") });
    });

    this.startWorkflowButton.addEventListener("click", () => {
      if (this.onStartWorkflow) {
        this.onStartWorkflow();
      }
    });

    this.selectElement.addEventListener("change", () => {
      this.renderProgress();
    });

    AppState.subscribe((state, changedKeys) => {
      if (changedKeys.includes("workflows")) {
        this.renderSelect(state.workflows);
      }
      if (
        changedKeys.includes("activeWorkflow") ||
        changedKeys.includes("activeWorkflowStepIndex")
      ) {
        this.renderProgress();
      }
    });

    this.renderSelect(AppState.getState().workflows);
    this.renderProgress();
  }

  getSelectedWorkflow() {
    const selectedId = this.selectElement.value;
    if (!selectedId) return null;
    return AppState.getState().workflows.find((wf) => wf.id === selectedId) || null;
  }

  renderSelect(workflows = AppState.getState().workflows) {
    const prev = this.selectElement.value;
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

    if (prev && workflows.some((wf) => wf.id === prev)) {
      this.selectElement.value = prev;
    }

    this.renderProgress();
  }

  renderProgress() {
    const state = AppState.getState();
    const workflow = this.getSelectedWorkflow();
    this.progressList.innerHTML = "";

    if (!workflow || workflow.steps.length === 0) return;

    const isActive = state.activeWorkflow && state.activeWorkflow.id === workflow.id;

    workflow.steps.forEach((step, index) => {
      // Arrow connector between steps
      if (index > 0) {
        const prevAction = workflow.steps[index - 1].chainConfig?.responseAction || "none";
        const arrow = document.createElement("div");
        arrow.className = "wpr-arrow" + (prevAction !== "none" ? " wpr-arrow-active" : "");
        arrow.title = prevAction === "extract" ? "extract →" : prevAction === "store_full" ? "full →" : "→";
        arrow.textContent = "→";
        this.progressList.appendChild(arrow);
      }

      // Step node
      const node = document.createElement("div");
      node.className = "wpr-node";
      if (isActive && state.activeWorkflowStepIndex === index) {
        node.classList.add("wpr-node-active");
      } else if (isActive && index < state.activeWorkflowStepIndex) {
        node.classList.add("wpr-node-done");
      }

      const label = document.createElement("div");
      label.className = "wpr-node-label";
      label.textContent = `STEP ${index + 1}`;

      const name = document.createElement("div");
      name.className = "wpr-node-name";
      name.textContent = step.title || `Step ${index + 1}`;
      name.title = step.title || "";

      node.appendChild(label);
      node.appendChild(name);
      this.progressList.appendChild(node);
    });
  }
}
