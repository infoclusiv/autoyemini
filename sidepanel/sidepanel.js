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

const { generateUUID, sleep, randomSleep } = globalThis.SharedUtils;
const AppConfig = globalThis.CONFIG;

let logPanel;
let questionList;
let controlPanel;
let statsPanel;
let settingsPanel;
let templatePanel;

let questionsInput;

function normalizeExtractionSettings(settings) {
  return {
    useExtraction: settings.useExtraction === true,
    extractionRegex:
      settings.extractionRegex || AppConfig.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>",
    injectionPlaceholder:
      settings.injectionPlaceholder ||
      AppConfig.EXTRACTION?.DEFAULT_PLACEHOLDER ||
      "{{extract}}"
  };
}

function replaceAllOccurrences(value, search, replacement) {
  return value.split(search).join(replacement);
}

function getExtractionExpression(pattern) {
  const normalizedPattern =
    pattern?.trim() || AppConfig.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
  const regexLiteralMatch = normalizedPattern.match(/^\/([\s\S]*)\/([a-z]*)$/i);

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

function buildQuestionForSubmission(questionText, settings, lastExtractedText) {
  const extractionSettings = normalizeExtractionSettings(settings);
  if (!extractionSettings.useExtraction || !lastExtractedText) {
    return questionText;
  }

  if (!questionText.includes(extractionSettings.injectionPlaceholder)) {
    return questionText;
  }

  addLog(t("messages.textInjected"), "info");
  return replaceAllOccurrences(
    questionText,
    extractionSettings.injectionPlaceholder,
    lastExtractedText
  );
}

function parseQuestionsInput(rawValue, isSinglePrompt) {
  if (isSinglePrompt) {
    return [rawValue];
  }

  const segments = rawValue.includes("===") ? rawValue.split("===") : rawValue.split("\n");
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function getElements() {
  return {
    questionsInput: document.getElementById("questionsInput"),
    singlePromptModeCheckbox: document.getElementById("singlePromptModeCheckbox"),
    addQuestionsBtn: document.getElementById("addQuestionsBtn"),
    clearInputBtn: document.getElementById("clearInputBtn"),
    templateSelect: document.getElementById("templateSelect"),
    loadTemplateBtn: document.getElementById("loadTemplateBtn"),
    saveTemplateBtn: document.getElementById("saveTemplateBtn"),
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
    useExtractionCheckbox: document.getElementById("useExtractionCheckbox"),
    extractionFields: document.getElementById("extractionFields"),
    extractionRegexInput: document.getElementById("extractionRegexInput"),
    injectionPlaceholderInput: document.getElementById("injectionPlaceholderInput"),
    humanTypingCheckbox: document.getElementById("humanTypingCheckbox"),
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
    progressFill: document.getElementById("progressFill")
  };
}

function addLog(message, level = "info") {
  logPanel.add(message, level);
}

function persistQuestions() {
  return saveQuestions(AppState.getState().questions);
}

function getFixedDelay(delayOrRange) {
  if (Array.isArray(delayOrRange)) {
    return Number(delayOrRange[0]) || 0;
  }

  return Number(delayOrRange) || 0;
}

async function waitForConfiguredDelay(delayOrRange, useRandomDelays = true) {
  if (useRandomDelays && Array.isArray(delayOrRange)) {
    await randomSleep(delayOrRange);
    return;
  }

  await sleep(getFixedDelay(delayOrRange));
}

function buildAntiBotConfig(settings) {
  const safeSettings = settings || settingsPanel.getValues();
  const minPauseMs = Math.round(safeSettings.fatigueMinMinutes * 60000);
  const maxPauseMs = Math.round(safeSettings.fatigueMaxMinutes * 60000);

  return {
    humanTyping: safeSettings.humanTyping,
    randomDelays: safeSettings.randomDelays,
    biologicalPauses: safeSettings.biologicalPauses,
    typingSpeed: [...safeSettings.typingSpeed],
    errorProbability: AppConfig.ANTI_BOT.ERROR_PROBABILITY,
    fatigueCount: safeSettings.fatigueCount,
    fatiguePauseMs: [Math.min(minPauseMs, maxPauseMs), Math.max(minPauseMs, maxPauseMs)]
  };
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

function patchExtractionState(settings) {
  const extractionSettings = normalizeExtractionSettings(settings);
  AppState.patch({
    useExtraction: extractionSettings.useExtraction,
    extractionRegex: extractionSettings.extractionRegex,
    injectionPlaceholder: extractionSettings.injectionPlaceholder
  });
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

async function persistExtractionSettings(settings) {
  const extractionSettings = normalizeExtractionSettings(settings);
  patchExtractionState(extractionSettings);
  await Promise.all([
    saveSetting(StorageKeys.USE_EXTRACTION, extractionSettings.useExtraction),
    saveSetting(StorageKeys.EXTRACTION_REGEX, extractionSettings.extractionRegex),
    saveSetting(StorageKeys.INJECTION_PLACEHOLDER, extractionSettings.injectionPlaceholder)
  ]);
}

async function maybeTakeBiologicalPause(settings) {
  const state = AppState.getState();
  if (!settings.biologicalPauses || state.processedSincePause < settings.fatigueCount) {
    return;
  }

  addLog(t("messages.biologicalPause"), "info");
  await randomSleep(buildAntiBotConfig(settings).fatiguePauseMs);

  const latestState = AppState.getState();
  if (!latestState.isRunning || latestState.isPaused) {
    return;
  }

  AppState.patch({ processedSincePause: 0 });
}

function handleAddQuestions() {
  const rawValue = questionsInput.value.trim();
  if (!rawValue) {
    addLog(t("messages.pleaseEnterQuestion"), "warning");
    return;
  }

  const isSinglePrompt = AppState.getState().singlePromptMode === true;
  const nextQuestions = [...AppState.getState().questions];
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
  await Promise.all([
    persistAntiBotSettings(antiBotSettings),
    persistExtractionSettings(antiBotSettings)
  ]);

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
  void processNextQuestion();
}

function handlePause() {
  AppState.patch({ isPaused: true });
  addLog(t("messages.executionPaused"), "warning");
}

function handleResume() {
  AppState.patch({ isPaused: false });
  addLog(t("messages.executionResumed"), "info");
  void processNextQuestion();
}

function handleStop() {
  AppState.patch({
    isRunning: false,
    isPaused: false,
    processedSincePause: 0,
    lastExtractedText: ""
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

async function processNextQuestion() {
  const state = AppState.getState();
  if (!state.isRunning || state.isPaused) {
    return;
  }

  const antiBotSettings = settingsPanel.getValues();
  await maybeTakeBiologicalPause(antiBotSettings);

  const refreshedState = AppState.getState();
  if (!refreshedState.isRunning || refreshedState.isPaused) {
    return;
  }

  let nextIndex = -1;
  for (let index = refreshedState.currentIndex; index < refreshedState.questions.length; index += 1) {
    if (refreshedState.questions[index].status === "pending") {
      nextIndex = index;
      break;
    }
  }

  if (nextIndex === -1) {
    AppState.patch({ isRunning: false, lastExtractedText: "" });
    addLog(t("messages.allCompleted"), "success");
    return;
  }

  const nextQuestion = refreshedState.questions[nextIndex];
  const submittedQuestion = buildQuestionForSubmission(
    nextQuestion.question,
    antiBotSettings,
    refreshedState.lastExtractedText
  );
  AppState.patch({ currentIndex: nextIndex });
  AppState.updateQuestion(nextQuestion.id, { status: "processing" });
  await persistQuestions();
  addLog(`[${nextIndex + 1}/${refreshedState.questions.length}]: ${nextQuestion.question.substring(0, 50)}...`, "info");

  try {
    const { useTempChat, useWebSearch, keepSameChat } = antiBotSettings;
    const response = await sendToBackground({
      type: "PROCESS_QUESTION",
      question: submittedQuestion,
      questionId: nextQuestion.id,
      useTempChat,
      useWebSearch,
      keepSameChat,
      antiBotConfig: buildAntiBotConfig(antiBotSettings)
    });

    if (!response?.success) {
      throw new Error(response?.error || "No response from background script");
    }

    addLog(t("messages.submittedWaiting"), "info");
  } catch (error) {
    AppState.updateQuestion(nextQuestion.id, { status: "failed", error: error.message });
    await persistQuestions();
    addLog(`${t("messages.processingFailed")}: ${error.message}`, "error");
    AppState.patch({ currentIndex: nextIndex + 1 });

    const latestState = AppState.getState();
    if (latestState.isRunning && !latestState.isPaused) {
      await sleep(2000);
      void processNextQuestion();
    }
  }
}

async function handleQuestionComplete(result) {
  const state = AppState.getState();
  const question = state.questions.find((entry) => entry.id === result.questionId);
  if (!question || question.status === "completed" || question.status === "failed") {
    return;
  }

  if (result.success) {
    AppState.updateQuestion(result.questionId, {
      status: "completed",
      answer: result.answer,
      sources: result.sources || [],
      completedAt: Date.now()
    });

    if (state.useExtraction) {
      try {
        const extractedText = extractTextFromAnswer(result.answer, state.extractionRegex);
        AppState.patch({ lastExtractedText: extractedText });

        if (extractedText) {
          addLog(t("messages.textExtracted"), "success");
        }
      } catch (error) {
        AppState.patch({ lastExtractedText: "" });
        addLog(`${t("messages.invalidExtractionRegex")}: ${error.message}`, "warning");
      }
    }

    addLog(`${t("messages.completed")}: ${question.question.substring(0, 50)}...`, "success");
  } else {
    AppState.updateQuestion(result.questionId, {
      status: "failed",
      error: result.error,
      completedAt: Date.now()
    });
    if (state.useExtraction) {
      AppState.patch({ lastExtractedText: "" });
    }
    addLog(`${t("messages.failed")}: ${question.question.substring(0, 50)}... - ${result.error}`, "error");
  }

  await persistQuestions();
  AppState.patch({
    currentIndex: state.currentIndex + 1,
    processedSincePause: state.processedSincePause + 1
  });

  const latestState = AppState.getState();
  if (latestState.isRunning && !latestState.isPaused) {
    addLog(t("messages.waitingNext"), "info");
    await waitForConfiguredDelay(
      AppConfig.TIMING.BETWEEN_QUESTIONS_MS,
      latestState.randomDelays
    );
    void processNextQuestion();
  }
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
  await persistAntiBotSettings(settings);
}

async function handleExtractionSettingsChange() {
  const settings = settingsPanel.getValues();
  settingsPanel.setExtractionVisibility(settings.useExtraction);
  await persistExtractionSettings(settings);
}

function wireMessageListeners() {
  onRuntimeMessage((message, sendResponse) => {
    switch (message.type) {
      case "QUESTION_COMPLETE":
        void handleQuestionComplete(message.result);
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

  onStorageChange((changes) => {
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
        void handleQuestionComplete(pendingMessage.result);
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
  elements.useExtractionCheckbox.addEventListener("change", () => {
    void handleExtractionSettingsChange();
  });
  elements.extractionRegexInput.addEventListener("change", () => {
    void handleExtractionSettingsChange();
  });
  elements.injectionPlaceholderInput.addEventListener("change", () => {
    void handleExtractionSettingsChange();
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
    useExtractionCheckbox: elements.useExtractionCheckbox,
    extractionFields: elements.extractionFields,
    extractionRegexInput: elements.extractionRegexInput,
    injectionPlaceholderInput: elements.injectionPlaceholderInput,
    humanTypingCheckbox: elements.humanTypingCheckbox,
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
    deleteButton: elements.deleteTemplateBtn,
    questionsInput,
    addLog
  });

  setupEventListeners(elements);
  wireMessageListeners();

  try {
    const stored = await loadAll();
    AppState.setQuestions(stored.questions);
    AppState.patch({
      templates: stored.templates,
      useTempChat: stored.useTempChat,
      useWebSearch: stored.useWebSearch,
      keepSameChat: stored.keepSameChat,
      singlePromptMode: stored.singlePromptMode,
      useExtraction: stored.useExtraction,
      extractionRegex: stored.extractionRegex,
      injectionPlaceholder: stored.injectionPlaceholder,
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