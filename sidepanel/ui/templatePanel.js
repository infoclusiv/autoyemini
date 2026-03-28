import { AppState } from "../state/appState.js";
import { saveSetting, StorageKeys } from "../services/storageService.js";
import { t } from "../i18n/i18n.js";

const { generateUUID } = globalThis.SharedUtils;

export class TemplatePanel {
  constructor({
    selectElement,
    loadButton,
    saveButton,
    deleteButton,
    questionsInput,
    addLog,
    onLoadTemplate
  }) {
    this.selectElement = selectElement;
    this.loadButton = loadButton;
    this.saveButton = saveButton;
    this.deleteButton = deleteButton;
    this.questionsInput = questionsInput;
    this.addLog = addLog;
    this.onLoadTemplate = onLoadTemplate;
    this.pendingSelectedTemplateId = "";

    this.loadButton.addEventListener("click", () => {
      this.handleLoad();
    });
    this.saveButton.addEventListener("click", () => {
      void this.handleSave();
    });
    this.deleteButton.addEventListener("click", () => {
      void this.handleDelete();
    });

    AppState.subscribe((state, changedKeys) => {
      if (changedKeys.includes("templates")) {
        this.render(state.templates);
      }
    });

    this.render(AppState.getState().templates);
  }

  getSelectedTemplate() {
    const selectedId = this.selectElement.value;
    if (!selectedId) {
      return null;
    }

    return AppState.getState().templates.find((template) => template.id === selectedId) || null;
  }

  render(templates = AppState.getState().templates) {
    const preferredValue = this.pendingSelectedTemplateId || this.selectElement.value;
    this.selectElement.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("template.selectDefault");
    this.selectElement.appendChild(defaultOption);

    templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      this.selectElement.appendChild(option);
    });

    if (preferredValue && templates.some((template) => template.id === preferredValue)) {
      this.selectElement.value = preferredValue;
    }

    this.pendingSelectedTemplateId = "";
  }

  async handleSave() {
    const content = this.questionsInput.value.trim();
    if (!content) {
      this.addLog(t("messages.pleaseEnterQuestion"), "warning");
      return;
    }

    const templateName = window.prompt(t("template.namePrompt"), "");
    if (templateName === null) {
      return;
    }

    const trimmedName = templateName.trim();
    if (!trimmedName) {
      this.addLog(t("messages.templateNameRequired"), "warning");
      return;
    }

    const state = AppState.getState();
    const template = {
      id: generateUUID(),
      name: trimmedName,
      content: this.questionsInput.value,
      useExtraction: state.useExtraction,
      extractionRegex: state.extractionRegex,
      injectionPlaceholder: state.injectionPlaceholder
    };
    const nextTemplates = [...AppState.getState().templates, template];

    this.pendingSelectedTemplateId = template.id;
    AppState.patch({ templates: nextTemplates });
    await saveSetting(StorageKeys.TEMPLATES, nextTemplates);
    this.addLog(t("messages.templateSaved"), "success");
  }

  handleLoad() {
    const selectedTemplate = this.getSelectedTemplate();
    if (!selectedTemplate) {
      this.addLog(t("messages.templateSelectRequired"), "warning");
      return;
    }

    this.questionsInput.value = selectedTemplate.content;
    if (this.onLoadTemplate) {
      this.onLoadTemplate(selectedTemplate);
    }
    this.addLog(t("messages.templateLoaded"), "info");
  }

  async handleDelete() {
    const selectedTemplate = this.getSelectedTemplate();
    if (!selectedTemplate) {
      this.addLog(t("messages.templateSelectRequired"), "warning");
      return;
    }

    if (!window.confirm(t("messages.confirmTemplateDelete"))) {
      return;
    }

    const nextTemplates = AppState.getState().templates.filter(
      (template) => template.id !== selectedTemplate.id
    );

    this.pendingSelectedTemplateId = "";
    AppState.patch({ templates: nextTemplates });
    await saveSetting(StorageKeys.TEMPLATES, nextTemplates);
    this.addLog(t("messages.templateDeleted"), "info");
  }
}