import { AppState } from "./state/appState.js";
import { loadAll, removePendingMessage, saveQuestions, saveSetting, StorageKeys } from "./services/storageService.js";
import { exportQuestionsToJSON } from "./services/exportService.js";
import { onRuntimeMessage, onStorageChange, sendToBackground } from "./services/messagingService.js";
import { applyTranslations, t } from "./i18n/i18n.js";
import { LogPanel } from "./ui/logPanel.js";
import { QuestionList } from "./ui/questionList.js";
import { ControlPanel } from "./ui/controlPanel.js";
import { StatsPanel } from "./ui/statsPanel.js";
import { SettingsPanel } from "./ui/settingsPanel.js";
import { TemplatePanel } from "./ui/templatePanel.js";
import { WorkflowRunner } from "./ui/workflowRunner.js";
import { normalizeWorkflows } from "./services/workflowService.js";
import { QuestionProcessor, parseQuestionsInput } from "./core/questionProcessor.js";
import { waitForConfiguredDelay } from "./core/antiBotController.js";

const { generateUUID, sleep, randomSleep } = globalThis.SharedUtils;
const AppConfig = globalThis.CONFIG;

let logPanel;
let questionList;
let controlPanel;
let statsPanel;
let settingsPanel;
let templatePanel;
let workflowRunner;
let questionProcessor;

let questionsInput;

function getElements() {
  return {
    questionsInput: document.getElementById("questionsInput"),
    singlePromptModeCheckbox: document.getElementById("singlePromptModeCheckbox"),
    addQuestionsBtn: document.getElementById("addQuestionsBtn"),
    clearInputBtn: document.getElementById("clearInputBtn"),
    templateSelect: document.getElementById("templateSelect"),
    loadTemplateBtn: document.getElementById("loadTemplateBtn"),
    saveTemplateBtn: document.getElementById("saveTemplateBtn"),
    updateTemplateBtn: document.getElementById("updateTemplateBtn"),
    renameTemplateBtn: document.getElementById("renameTemplateBtn"),
    deleteTemplateBtn: document.getElementById("deleteTemplateBtn"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resumeBtn: document.getElementById("resumeBtn"),
    stopBtn: document.getElementById("stopBtn"),
    stopBtn2: document.getElementById("stopBtn2"),
    retryFailedBtn: document.getElementById("retryFailedBtn"),
    exportBtn: document.getElementById("exportBtn"),
    useTempChatCheckbox: document.getElementById("useTempChatCheckbox"),
    useWebSearchCheckbox: document.getElementById("useWebSearchCheckbox"),
    keepSameChatCheckbox: document.getElementById("keepSameChatCheckbox"),
    humanTypingCheckbox: document.getElementById("humanTypingCheckbox"),
    humanTypingFields: document.getElementById("humanTypingFields"),
    typingSpeedMinInput: document.getElementById("typingSpeedMinInput"),
    typingSpeedMaxInput: document.getElementById("typingSpeedMaxInput"),
    randomDelaysCheckbox: document.getElementById("randomDelaysCheckbox"),
    biologicalPausesCheckbox: document.getElementById("biologicalPausesCheckbox"),
    biologicalPauseFields: document.getElementById("biologicalPauseFields"),
    fatigueCountInput: document.getElementById("fatigueCountInput"),
    fatigueMinMinutesInput: document.getElementById("fatigueMinMinutesInput"),
    fatigueMaxMinutesInput: document.getElementById("fatigueMaxMinutesInput"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    progressText: document.getElementById("progressText"),
    progressPercent: document.getElementById("progressPercent"),
    idleButtons: document.getElementById("idleButtons"),
    runningButtons: document.getElementById("runningButtons"),
    pausedButtons: document.getElementById("pausedButtons"),
    retryButtonContainer: document.getElementById("retryButtonContainer"),
    questionsList: document.getElementById("questionsList"),
    logContainer: document.getElementById("logContainer"),
    totalCount: document.getElementById("totalCount"),
    completedCount: document.getElementById("completedCount"),
    successCount: document.getElementById("successCount"),
    failedCount: document.getElementById("failedCount"),
    progressFill: document.getElementById("progressFill"),
    workflowSection: document.getElementById("workflowSection")
  };
}

function addLog(message, level = "info") {
  logPanel.add(message, level);
}

function persistQuestions() {
  return saveQuestions(AppState.getState().questions);
}

function patchGeneralSettings(settings) {
  AppState.patch({
    useTempChat: settings.useTempChat,
    useWebSearch: settings.useWebSearch,
    keepSameChat: settings.keepSameChat
  });
}

function patchAntiBotState(settings) {
  AppState.patch({
    humanTyping: settings.humanTyping,
    randomDelays: settings.randomDelays,
    biologicalPauses: settings.biologicalPauses,
    typingSpeed: [...settings.typingSpeed],
    fatigueCount: settings.fatigueCount,
    fatigueMinMinutes: settings.fatigueMinMinutes,
    fatigueMaxMinutes: settings.fatigueMaxMinutes
  });
}

async function persistGeneralSettings(settings) {
  patchGeneralSettings(settings);
  await Promise.all([
    saveSetting(StorageKeys.USE_TEMP_CHAT, settings.useTempChat),
    saveSetting(StorageKeys.USE_WEB_SEARCH, settings.useWebSearch),
    saveSetting(StorageKeys.KEEP_SAME_CHAT, settings.keepSameChat)
  ]);
}

async function persistAntiBotSettings(settings) {
  patchAntiBotState(settings);
  await Promise.all([
    saveSetting(StorageKeys.HUMAN_TYPING, settings.humanTyping),
    saveSetting(StorageKeys.RANDOM_DELAYS, settings.randomDelays),
    saveSetting(StorageKeys.BIOLOGICAL_PAUSES, settings.biologicalPauses),
    saveSetting(StorageKeys.TYPING_SPEED, settings.typingSpeed),
    saveSetting(StorageKeys.FATIGUE_COUNT, settings.fatigueCount),
    saveSetting(StorageKeys.FATIGUE_MIN_PAUSE_MINUTES, settings.fatigueMinMinutes),
    saveSetting(StorageKeys.FATIGUE_MAX_PAUSE_MINUTES, settings.fatigueMaxMinutes)
  ]);
}

function handleAddQuestions() {
  const rawValue = questionsInput.value.trim();
  if (!rawValue) {
    addLog(t("messages.pleaseEnterQuestion"), "warning");
    return;
  }

  const state = AppState.getState();
  const isSinglePrompt = state.singlePromptMode === true;
  const nextQuestions = [...state.questions];
  const questionsToAdd = parseQuestionsInput(rawValue, isSinglePrompt);

  questionsToAdd.forEach((question) => {
    nextQuestions.push({
      id: generateUUID(),
      question,
      status: "pending",
      answer: "",
      sources: [],
      timestamp: Date.now(),
      error: null
    });
  });

  if (questionsToAdd.length === 0) {
    return;
  }

  questionsInput.value = "";
  AppState.setQuestions(nextQuestions);
  void persistQuestions();
  addLog(`${questionsToAdd.length} ${t("messages.questionsAdded")}`, "success");
}

function handleClearInput() {
  questionsInput.value = "";
  addLog(t("messages.inputCleared"), "info");
}

async function handleStart() {
  const state = AppState.getState();
  if (state.isRunning) {
    addLog(t("messages.alreadyRunning"), "warning");
    return;
  }

  if (state.questions.length === 0) {
    addLog(t("messages.noQuestions"), "warning");
    return;
  }

  const pendingQuestions = state.questions.filter(
    (question) => question.status === "pending" || question.status === "failed"
  );
  if (pendingQuestions.length === 0) {
    addLog(t("messages.noQuestions"), "warning");
    return;
  }

  const sanitizedQuestions = state.questions.map((question) => {
    if (question.status === "failed") {
      return { ...question, status: "pending", error: null };
    }
    return question;
  });

  AppState.setQuestions(sanitizedQuestions);
  await persistQuestions();
  addLog(t("messages.openingChatGPT"), "info");

  try {
    const { useTempChat, useWebSearch, keepSameChat } = settingsPanel.getValues();
    const response = await sendToBackground({
      type: "OPEN_CHATGPT",
      useTempChat,
      useWebSearch,
      keepSameChat
    });

    if (!response?.success) {
      addLog(`${t("messages.cannotOpenChatGPT")}: ${response?.error || "Unknown error"}`, "error");
      return;
    }
  } catch (error) {
    addLog(`${t("messages.error")}: ${error.message}`, "error");
    return;
  }

  const antiBotSettings = settingsPanel.getValues();
  await persistAntiBotSettings(antiBotSettings);

  AppState.patch({
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    processedSincePause: 0,
    lastExtractedText: ""
  });
  addLog(t("messages.startingBatch"), "info");
  addLog(t("messages.foundPending", { count: pendingQuestions.length }), "info");
  addLog(t("messages.waitingPage"), "info");

  await waitForConfiguredDelay(AppConfig.TIMING.BETWEEN_QUESTIONS_MS, antiBotSettings.randomDelays);
  addLog(t("messages.startingFirst"), "info");
  void questionProcessor.processNextQuestion();
}

function loadWorkflowStepQuestions(template, chainedText, step) {
  const state = AppState.getState();
  const isSinglePrompt = state.singlePromptMode === true;

  const defaultRegex =
    globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
  const defaultPlaceholder =
    globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";

  const stepChainConfig = step?.chainConfig || {};
  const responseAction = stepChainConfig.responseAction || "none";
  const extractionRegex = stepChainConfig.extractionRegex || defaultRegex;
  const injectionPlaceholder = stepChainConfig.injectionPlaceholder || defaultPlaceholder;

  const extractionConfig = {
    useExtraction: responseAction === "extract",
    extractionRegex,
    injectionPlaceholder
  };

  // Resolve the template content: replace the placeholder with chainedText
  let resolvedContent = template.content;
  if (chainedText && injectionPlaceholder) {
    resolvedContent = resolvedContent
      .split(injectionPlaceholder)
      .join(chainedText);
  }

  const questionsToAdd = parseQuestionsInput(resolvedContent, isSinglePrompt);

  const nextQuestions = [...state.questions];
  questionsToAdd.forEach((question) => {
    nextQuestions.push({
      id: generateUUID(),
      question,
      status: "pending",
      answer: "",
      sources: [],
      timestamp: Date.now(),
      error: null,
      extractionConfig
    });
  });

  AppState.setQuestions(nextQuestions);
  void persistQuestions();
  return questionsToAdd.length;
}

function applyTemplateSettings(template) {
  if (!template.settings) {
    return;
  }
  settingsPanel.setValuesFromTemplate(template.settings);
  const resolvedSettings = settingsPanel.getValues();
  patchGeneralSettings(resolvedSettings);
  patchAntiBotState(resolvedSettings);
  void Promise.all([
    persistGeneralSettings(resolvedSettings),
    persistAntiBotSettings(resolvedSettings)
  ]);
}

async function handleStartWorkflow() {
  const state = AppState.getState();
  if (state.isRunning) {
    addLog(t("messages.alreadyRunning"), "warning");
    return;
  }

  const workflow = workflowRunner.getSelectedWorkflow();
  if (!workflow) {
    addLog(t("messages.workflowSelectRequired"), "warning");
    return;
  }

  if (workflow.steps.length === 0) {
    addLog(t("messages.workflowNoSteps"), "warning");
    return;
  }

  const templates = state.templates;
  const validSteps = workflow.steps.filter((step) =>
    templates.some((tpl) => tpl.id === step.templateId)
  );

  if (validSteps.length === 0) {
    addLog(t("messages.workflowNoSteps"), "warning");
    return;
  }

  if (validSteps.length < workflow.steps.length) {
    addLog(t("workflow.invalidSteps"), "warning");
  }

  // Clear existing questions before starting the workflow
  AppState.setQuestions([]);
  await persistQuestions();

  addLog(t("messages.workflowStarting", { name: workflow.name }), "info");

  AppState.patch({
    activeWorkflow: { ...workflow, steps: validSteps },
    activeWorkflowStepIndex: 0,
    workflowContext: {
      chainedText: "",
      stepResults: []
    }
  });

  await executeWorkflowStep(0);
}

async function executeWorkflowStep(stepIndex) {
  const state = AppState.getState();
  const workflow = state.activeWorkflow;

  if (!workflow || stepIndex >= workflow.steps.length) {
    addLog(t("messages.workflowComplete"), "success");
    AppState.patch({ activeWorkflow: null, activeWorkflowStepIndex: -1, workflowContext: null });
    return;
  }

  const step = workflow.steps[stepIndex];
  const template = state.templates.find((tpl) => tpl.id === step.templateId);

  if (!template) {
    AppState.patch({ activeWorkflowStepIndex: stepIndex + 1 });
    await executeWorkflowStep(stepIndex + 1);
    return;
  }

  AppState.patch({ activeWorkflowStepIndex: stepIndex });
  addLog(t("messages.workflowStepStarting", [stepIndex + 1, template.name]), "info");

  applyTemplateSettings(template);

  // Get the chainedText from the workflow context
  const chainedText = state.workflowContext?.chainedText || "";
  if (chainedText && stepIndex > 0) {
    addLog(`Chained data available (${chainedText.length} chars)`, "info");
  }

  // Clear questions from previous step before loading new ones
  AppState.setQuestions([]);
  await persistQuestions();

  const addedCount = loadWorkflowStepQuestions(template, chainedText, step);
  addLog(`${addedCount} ${t("messages.questionsAdded")}`, "success");

  addLog(t("messages.openingChatGPT"), "info");

  try {
    const { useTempChat, useWebSearch, keepSameChat } = settingsPanel.getValues();
    const response = await sendToBackground({
      type: "OPEN_CHATGPT",
      useTempChat,
      useWebSearch,
      keepSameChat
    });

    if (!response?.success) {
      addLog(`${t("messages.cannotOpenChatGPT")}: ${response?.error || "Unknown error"}`, "error");
      abortWorkflow();
      return;
    }
  } catch (error) {
    addLog(`${t("messages.error")}: ${error.message}`, "error");
    abortWorkflow();
    return;
  }

  const antiBotSettings = settingsPanel.getValues();
  await persistAntiBotSettings(antiBotSettings);

  const pendingQuestions = AppState.getState().questions.filter(
    (q) => q.status === "pending"
  );

  // Preserve lastExtractedText from workflow context instead of resetting
  AppState.patch({
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    processedSincePause: 0,
    lastExtractedText: chainedText
  });

  addLog(t("messages.startingBatch"), "info");
  addLog(t("messages.foundPending", { count: pendingQuestions.length }), "info");
  addLog(t("messages.waitingPage"), "info");

  await waitForConfiguredDelay(AppConfig.TIMING.BETWEEN_QUESTIONS_MS, antiBotSettings.randomDelays);
  addLog(t("messages.startingFirst"), "info");
  void questionProcessor.processNextQuestion();
}

async function advanceWorkflowStep() {
  const state = AppState.getState();
  if (!state.activeWorkflow) {
    return;
  }

  const nextStepIndex = state.activeWorkflowStepIndex + 1;
  addLog(t("messages.workflowStepComplete", { num: state.activeWorkflowStepIndex + 1 }), "success");

  if (nextStepIndex >= state.activeWorkflow.steps.length) {
    addLog(t("messages.workflowComplete"), "success");
    AppState.patch({ activeWorkflow: null, activeWorkflowStepIndex: -1, workflowContext: null });
    return;
  }

  await executeWorkflowStep(nextStepIndex);
}

function abortWorkflow() {
  addLog("Workflow aborted.", "error");
  AppState.patch({
    isRunning: false,
    isPaused: false,
    processedSincePause: 0,
    lastExtractedText: "",
    activeWorkflow: null,
    activeWorkflowStepIndex: -1,
    workflowContext: null
  });
}

function handlePause() {
  AppState.patch({ isPaused: true });
  addLog(t("messages.executionPaused"), "warning");
}

function handleResume() {
  AppState.patch({ isPaused: false });
  addLog(t("messages.executionResumed"), "info");
  void questionProcessor.processNextQuestion();
}

function handleStop() {
  AppState.patch({
    isRunning: false,
    isPaused: false,
    processedSincePause: 0,
    lastExtractedText: "",
    activeWorkflow: null,
    activeWorkflowStepIndex: -1,
    workflowContext: null
  });
  addLog(t("messages.executionStopped"), "warning");
}

async function handleRetryFailed() {
  const state = AppState.getState();
  if (state.isRunning) {
    addLog(t("messages.pleaseStopFirst"), "warning");
    return;
  }

  const failedQuestions = state.questions.filter((question) => question.status === "failed");
  if (failedQuestions.length === 0) {
    addLog(t("messages.noFailedQuestions"), "info");
    return;
  }

  const nextQuestions = state.questions.map((question) =>
    question.status === "failed" ? { ...question, status: "pending", error: null } : question
  );

  AppState.setQuestions(nextQuestions);
  await persistQuestions();
  addLog(t("messages.resetFailed", { count: failedQuestions.length }), "success");
}

function handleExport() {
  const state = AppState.getState();
  if (state.questions.length === 0) {
    addLog(t("messages.noResults"), "warning");
    return;
  }

  exportQuestionsToJSON(state.questions);
  addLog(t("messages.resultsExported"), "success");
}

async function handleClearAll() {
  const state = AppState.getState();
  if (state.isRunning) {
    addLog(t("messages.pleaseStopFirst"), "warning");
    return;
  }

  if (!window.confirm(t("messages.confirmClearAll"))) {
    return;
  }

  AppState.setQuestions([]);
  await persistQuestions();
  addLog(t("messages.allCleared"), "info");
}

async function handleTempChatChange(event) {
  const enabled = event.target.checked;
  AppState.patch({ useTempChat: enabled });
  await saveSetting(StorageKeys.USE_TEMP_CHAT, enabled);
  addLog(t(enabled ? "msgTempChatEnabled" : "msgTempChatDisabled"), "info");
}

async function handleWebSearchChange(event) {
  const enabled = event.target.checked;
  AppState.patch({ useWebSearch: enabled });
  await saveSetting(StorageKeys.USE_WEB_SEARCH, enabled);
  addLog(t(enabled ? "msgWebSearchEnabled" : "msgWebSearchDisabled"), "info");
}

async function handleKeepSameChatChange(event) {
  const enabled = event.target.checked;
  AppState.patch({ keepSameChat: enabled });
  await saveSetting(StorageKeys.KEEP_SAME_CHAT, enabled);
}

async function handleSinglePromptModeChange(event) {
  const enabled = event.target.checked;
  AppState.patch({ singlePromptMode: enabled });
  await saveSetting(StorageKeys.SINGLE_PROMPT_MODE, enabled);
}

async function handleAntiBotSettingsChange() {
  const settings = settingsPanel.getValues();
  settingsPanel.setBiologicalPauseVisibility(settings.biologicalPauses);
  settingsPanel.setHumanTypingVisibility(settings.humanTyping);
  await persistAntiBotSettings(settings);
}

function wireMessageListeners() {
  onRuntimeMessage((message, sendResponse) => {
    switch (message.type) {
      case "QUESTION_COMPLETE":
        void questionProcessor.handleQuestionComplete(message.result);
        sendResponse({ received: true });
        break;
      case "UPDATE_PROGRESS":
        sendResponse({ received: true });
        break;
      case "LOG_MESSAGE":
        addLog(message.message, message.level || "info");
        sendResponse({ received: true });
        break;
      default:
        sendResponse({ received: false });
        break;
    }
  });

  // Reload workflows when the external workflow editor modifies them
  onStorageChange((changes) => {
    if (changes.savedWorkflows) {
      const rawWorkflows = changes.savedWorkflows.newValue;
      const normalized = normalizeWorkflows(rawWorkflows, AppState.getState().templates);
      AppState.patch({ workflows: normalized });
    }
    if (!changes.pendingMessage) {
      return;
    }

    const pendingMessage = changes.pendingMessage.newValue;
    if (!pendingMessage) {
      return;
    }

    const state = AppState.getState();
    if (
      pendingMessage.timestamp &&
      pendingMessage.timestamp <= state.lastProcessedMessageTimestamp
    ) {
      return;
    }

    if (pendingMessage.timestamp) {
      AppState.patch({ lastProcessedMessageTimestamp: pendingMessage.timestamp });
    }

    switch (pendingMessage.type) {
      case "QUESTION_COMPLETE":
        void questionProcessor.handleQuestionComplete(pendingMessage.result);
        void removePendingMessage();
        break;
      case "UPDATE_PROGRESS":
        void removePendingMessage();
        break;
      case "LOG_MESSAGE":
        addLog(pendingMessage.message, pendingMessage.level || "info");
        void removePendingMessage();
        break;
      default:
        break;
    }
  });
}

function setupEventListeners(elements) {
  elements.addQuestionsBtn.addEventListener("click", handleAddQuestions);
  elements.clearInputBtn.addEventListener("click", handleClearInput);
  elements.startBtn.addEventListener("click", () => {
    void handleStart();
  });
  elements.pauseBtn.addEventListener("click", handlePause);
  elements.resumeBtn.addEventListener("click", handleResume);
  elements.stopBtn.addEventListener("click", handleStop);
  elements.stopBtn2.addEventListener("click", handleStop);
  elements.retryFailedBtn.addEventListener("click", () => {
    void handleRetryFailed();
  });
  elements.exportBtn.addEventListener("click", handleExport);
  elements.clearAllBtn.addEventListener("click", () => {
    void handleClearAll();
  });
  elements.useTempChatCheckbox.addEventListener("change", (event) => {
    void handleTempChatChange(event);
  });
  elements.useWebSearchCheckbox.addEventListener("change", (event) => {
    void handleWebSearchChange(event);
  });
  elements.keepSameChatCheckbox.addEventListener("change", (event) => {
    void handleKeepSameChatChange(event);
  });
  elements.singlePromptModeCheckbox.addEventListener("change", (event) => {
    void handleSinglePromptModeChange(event);
  });
  elements.humanTypingCheckbox.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.randomDelaysCheckbox.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.biologicalPausesCheckbox.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.fatigueCountInput.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.fatigueMinMinutesInput.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.fatigueMaxMinutesInput.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.typingSpeedMinInput.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
  elements.typingSpeedMaxInput.addEventListener("change", () => {
    void handleAntiBotSettingsChange();
  });
}

async function initialize() {
  applyTranslations();

  const elements = getElements();
  questionsInput = elements.questionsInput;

  logPanel = new LogPanel(elements.logContainer);
  questionList = new QuestionList(elements.questionsList);
  controlPanel = new ControlPanel({
    idleButtons: elements.idleButtons,
    runningButtons: elements.runningButtons,
    pausedButtons: elements.pausedButtons,
    retryButtonContainer: elements.retryButtonContainer
  });
  statsPanel = new StatsPanel({
    totalEl: elements.totalCount,
    completedEl: elements.completedCount,
    successEl: elements.successCount,
    failedEl: elements.failedCount,
    progressFillEl: elements.progressFill,
    progressTextEl: elements.progressText,
    progressPercentEl: elements.progressPercent
  });
  settingsPanel = new SettingsPanel({
    useTempChatCheckbox: elements.useTempChatCheckbox,
    useWebSearchCheckbox: elements.useWebSearchCheckbox,
    keepSameChatCheckbox: elements.keepSameChatCheckbox,
    humanTypingCheckbox: elements.humanTypingCheckbox,
    humanTypingFields: elements.humanTypingFields,
    typingSpeedMinInput: elements.typingSpeedMinInput,
    typingSpeedMaxInput: elements.typingSpeedMaxInput,
    randomDelaysCheckbox: elements.randomDelaysCheckbox,
    biologicalPausesCheckbox: elements.biologicalPausesCheckbox,
    biologicalPauseFields: elements.biologicalPauseFields,
    fatigueCountInput: elements.fatigueCountInput,
    fatigueMinMinutesInput: elements.fatigueMinMinutesInput,
    fatigueMaxMinutesInput: elements.fatigueMaxMinutesInput
  });
  templatePanel = new TemplatePanel({
    selectElement: elements.templateSelect,
    loadButton: elements.loadTemplateBtn,
    saveButton: elements.saveTemplateBtn,
    updateButton: elements.updateTemplateBtn,
    renameButton: elements.renameTemplateBtn,
    deleteButton: elements.deleteTemplateBtn,
    questionsInput,
    addLog,
    getSettings: () => settingsPanel.getValues(),
    onLoadTemplate: (template) => {
      settingsPanel.setValuesFromTemplate(template.settings);
      const resolvedSettings = settingsPanel.getValues();
      void Promise.all([
        persistGeneralSettings(resolvedSettings),
        persistAntiBotSettings(resolvedSettings)
      ]);
    }
  });

  workflowRunner = new WorkflowRunner({
    containerElement: elements.workflowSection,
    addLog,
    onStartWorkflow: () => {
      void handleStartWorkflow();
    }
  });

  questionProcessor = new QuestionProcessor({
    getSettings: () => settingsPanel.getValues(),
    addLog,
    onAllCompleted: () => {
      void advanceWorkflowStep();
    },
    onWorkflowAbort: () => {
      abortWorkflow();
    }
  });

  setupEventListeners(elements);
  wireMessageListeners();

  try {
    const stored = await loadAll();
    AppState.setQuestions(stored.questions);
    AppState.patch({
      templates: stored.templates,
      workflows: stored.workflows,
      useTempChat: stored.useTempChat,
      useWebSearch: stored.useWebSearch,
      keepSameChat: stored.keepSameChat,
      singlePromptMode: stored.singlePromptMode,
      humanTyping: stored.humanTyping,
      randomDelays: stored.randomDelays,
      biologicalPauses: stored.biologicalPauses,
      typingSpeed: stored.typingSpeed,
      fatigueCount: stored.fatigueCount,
      fatigueMinMinutes: stored.fatigueMinMinutes,
      fatigueMaxMinutes: stored.fatigueMaxMinutes
    });
    elements.singlePromptModeCheckbox.checked = stored.singlePromptMode;
    settingsPanel.setValues(stored);

    if (stored.questions.length > 0) {
      addLog(t("messages.loadedQuestions", { count: stored.questions.length }), "info");
    }
  } catch (error) {
    addLog(`${t("messages.loadFailed")}: ${error.message}`, "error");
  }

  questionList.render();
  controlPanel.render();
  statsPanel.render();
  addLog(t("messages.ready"), "success");
}

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});