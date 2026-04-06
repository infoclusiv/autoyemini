import { AppState } from "./state/appState.js";
import { loadAll, removePendingMessage, saveQuestions, saveSetting, saveWorkflows, saveWorkflowBackup, loadWorkflowBackups, StorageKeys } from "./services/storageService.js";
import { exportQuestionsToJSON, exportSingleWorkflow } from "./services/exportService.js";
import { onRuntimeMessage, onStorageChange, sendToBackground } from "./services/messagingService.js";
import { applyTranslations, t } from "./i18n/i18n.js";
import { LogPanel } from "./ui/logPanel.js";
import { QuestionList } from "./ui/questionList.js";
import { ControlPanel } from "./ui/controlPanel.js";
import { StatsPanel } from "./ui/statsPanel.js";
import { SettingsPanel } from "./ui/settingsPanel.js";
import { WorkflowRunner } from "./ui/workflowRunner.js";
import { countStoredSteps, normalizeWorkflows } from "./services/workflowService.js";
import { QuestionProcessor, parseQuestionsInput } from "./core/questionProcessor.js";
import { waitForConfiguredDelay } from "./core/antiBotController.js";

const { generateUUID, sleep, randomSleep } = globalThis.SharedUtils;
const AppConfig = globalThis.CONFIG;

let logPanel;
let questionList;
let controlPanel;
let statsPanel;
let settingsPanel;
let workflowRunner;
let questionProcessor;

function getElements() {
  return {
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

async function persistGeneralSettings(settings) {
  patchGeneralSettings(settings);
  await Promise.all([
    saveSetting(StorageKeys.USE_TEMP_CHAT, settings.useTempChat),
    saveSetting(StorageKeys.USE_WEB_SEARCH, settings.useWebSearch),
    saveSetting(StorageKeys.KEEP_SAME_CHAT, settings.keepSameChat)
  ]);
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

  const antiBotSettings = AppState.getState();

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

function loadWorkflowStepQuestions(step, chainedText) {
  const state = AppState.getState();

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

  // Resolve the step content: replace the placeholder with chainedText
  let resolvedContent = step.content || "";
  if (chainedText && injectionPlaceholder) {
    resolvedContent = resolvedContent
      .split(injectionPlaceholder)
      .join(chainedText);
  }

  // Always treat the step content as a single multi-line prompt
  const questionsToAdd = parseQuestionsInput(resolvedContent, true);

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
      extractionConfig,
      stepProvider: step.provider || "chatgpt"
    });
  });

  AppState.setQuestions(nextQuestions);
  void persistQuestions();
  return questionsToAdd.length;
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

  // Auto-backup the workflow snapshot before execution (fire-and-forget)
  void saveWorkflowBackup(workflow);

  // Clear existing questions before starting the workflow
  AppState.setQuestions([]);
  await persistQuestions();

  addLog(t("messages.workflowStarting", { name: workflow.name }), "info");

  AppState.patch({
    activeWorkflow: { ...workflow },
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

  AppState.patch({ activeWorkflowStepIndex: stepIndex });
  addLog(t("messages.workflowStepStarting", [stepIndex + 1, step.title || `Step ${stepIndex + 1}`]), "info");

  // Get the chainedText from the workflow context
  const chainedText = state.workflowContext?.chainedText || "";
  if (chainedText && stepIndex > 0) {
    addLog(`Chained data available (${chainedText.length} chars)`, "info");
  }

  // ── External source injection for step 0 ──────────────────────────────
  let effectiveChainedText = chainedText;
  const extSrc = step.chainConfig?.externalSource;
  if (stepIndex === 0 && extSrc?.enabled) {
    try {
      const resp = await fetch(extSrc.url || "http://localhost:7788/api/best-title");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.title || data.status !== "ready") {
        addLog("⚠️ External source has no title ready. Run clusiv-v3 analysis first.", "warning");
        abortWorkflow();
        return;
      }
      effectiveChainedText = data.title;
      addLog(`🌐 External title fetched: "${effectiveChainedText}"`, "info");
    } catch (err) {
      addLog(`🌐 External source fetch failed: ${err.message}`, "error");
      abortWorkflow();
      return;
    }
  }

  // Clear questions from previous step before loading new ones
  AppState.setQuestions([]);
  await persistQuestions();

  // When external source is active for step 0, use its placeholder as the injectionPlaceholder
  const stepForLoad = (stepIndex === 0 && extSrc?.enabled && extSrc?.placeholder)
    ? { ...step, chainConfig: { ...step.chainConfig, injectionPlaceholder: extSrc.placeholder } }
    : step;
  const addedCount = loadWorkflowStepQuestions(stepForLoad, effectiveChainedText);
  addLog(`${addedCount} ${t("messages.questionsAdded")}`, "success");

  addLog(t("messages.openingChatGPT"), "info");

  try {
    const { useTempChat, useWebSearch, keepSameChat } = settingsPanel.getValues();
    const response = await sendToBackground({
      type: "OPEN_CHATGPT",
      providerId: step.provider || "chatgpt",
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

  // Apply this step's anti-bot config to AppState so QuestionProcessor picks it up
  const stepAntiBotConfig = step.antiBotConfig || {};
  AppState.patch({
    humanTyping: stepAntiBotConfig.humanTyping !== false,
    randomDelays: stepAntiBotConfig.randomDelays !== false,
    biologicalPauses: stepAntiBotConfig.biologicalPauses === true,
    typingSpeed: Array.isArray(stepAntiBotConfig.typingSpeed) ? [...stepAntiBotConfig.typingSpeed] : [30, 100],
    fatigueCount: stepAntiBotConfig.fatigueCount ?? 10,
    fatigueMinMinutes: stepAntiBotConfig.fatigueMinMinutes ?? 0.5,
    fatigueMaxMinutes: stepAntiBotConfig.fatigueMaxMinutes ?? 1
  });

  const pendingQuestions = AppState.getState().questions.filter(
    (q) => q.status === "pending"
  );

  // Preserve lastExtractedText from workflow context instead of resetting
  AppState.patch({
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    processedSincePause: 0,
    lastExtractedText: effectiveChainedText
  });

  addLog(t("messages.startingBatch"), "info");
  addLog(t("messages.foundPending", { count: pendingQuestions.length }), "info");
  addLog(t("messages.waitingPage"), "info");

  const antiBotSettings = AppState.getState();
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

    const totalStoredSteps = countStoredSteps(state.activeWorkflow);
    if (totalStoredSteps === 0) {
      addLog("Workflow completed without any 'Store full response' steps. Teleprompter merge was skipped.", "warning");
      AppState.patch({ activeWorkflow: null, activeWorkflowStepIndex: -1, workflowContext: null });
      return;
    }

    // Notify clusiv-v3 to merge teleprompter scripts (fire-and-warn, never aborts workflow)
    try {
      const resp = await fetch("http://localhost:7788/api/workflow-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowName: state.activeWorkflow.name,
          totalStoredSteps,
          totalSteps: totalStoredSteps
        })
      });
      if (!resp.ok) {
        const raw = await resp.text();
        addLog(`⚠️ clusiv-v3 respondió ${resp.status}: ${raw || "(sin cuerpo)"}`, "warning");
      } else {
        const data = await resp.json();
        if (data.success) {
          addLog(`✅ Teleprompter script guardado en: ${data.path} (${data.blocksFound} bloques)`, "success");
        } else {
          addLog(`⚠️ No se pudo generar el script: ${data.error}`, "warning");
        }
      }
    } catch (err) {
      addLog(`⚠️ No se pudo conectar a clusiv-v3: ${err.message}`, "warning");
    }

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
      const normalized = normalizeWorkflows(rawWorkflows);
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

async function toggleWorkflowBackupList() {
  const list = document.getElementById("workflowBackupList");
  const btn = document.getElementById("workflowBackupHistoryBtn");
  const isHidden = list.hidden;
  list.hidden = !isHidden;
  btn.textContent = isHidden ? "🕐 Ocultar Historial" : "🕐 Historial de Backups";
  if (isHidden) {
    await renderWorkflowBackupList();
  }
}

async function renderWorkflowBackupList() {
  const list = document.getElementById("workflowBackupList");
  const backups = await loadWorkflowBackups();
  list.innerHTML = "";

  if (backups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "No hay backups todavía. Ejecuta un workflow para crear uno.";
    list.appendChild(empty);
    return;
  }

  backups.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "backup-entry";

    const header = document.createElement("div");
    header.className = "backup-entry-header";

    const nameEl = document.createElement("span");
    nameEl.className = "backup-entry-name";
    nameEl.textContent = entry.workflowName;

    const timeEl = document.createElement("span");
    timeEl.className = "backup-entry-time";
    timeEl.textContent = new Date(entry.timestamp).toLocaleString();

    header.appendChild(nameEl);
    header.appendChild(timeEl);

    const meta = document.createElement("div");
    meta.className = "backup-entry-meta";
    meta.textContent = `${entry.stepCount} step${entry.stepCount !== 1 ? "s" : ""}`;

    const actions = document.createElement("div");
    actions.className = "backup-entry-actions";

    const exportBtn = document.createElement("button");
    exportBtn.className = "btn btn-sm btn-info";
    exportBtn.textContent = "⬇ Exportar";
    exportBtn.addEventListener("click", () => {
      exportSingleWorkflow(entry.snapshot);
    });

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn btn-sm btn-success";
    restoreBtn.textContent = "↩ Restaurar";
    restoreBtn.addEventListener("click", () => {
      void restoreWorkflowFromBackup(entry);
    });

    actions.appendChild(exportBtn);
    actions.appendChild(restoreBtn);

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

async function restoreWorkflowFromBackup(entry) {
  const confirmed = window.confirm(
    `¿Restaurar el workflow "${entry.workflowName}" (${entry.stepCount} steps) desde el backup del ${new Date(entry.timestamp).toLocaleString()}?`
  );
  if (!confirmed) return;

  const state = AppState.getState();
  const existing = state.workflows;
  const idx = existing.findIndex((wf) => wf.id === entry.snapshot.id);
  const updated = idx >= 0
    ? existing.map((wf, i) => (i === idx ? entry.snapshot : wf))
    : [...existing, entry.snapshot];

  await saveWorkflows(updated);
  AppState.patch({ workflows: updated });
  addLog(`Workflow "${entry.workflowName}" restaurado desde backup.`, "success");
}

function setupEventListeners(elements) {
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

  document.getElementById("workflowBackupHistoryBtn").addEventListener("click", () => {
    void toggleWorkflowBackupList();
  });

  document.getElementById("openProviderEditorBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("provider-editor.html") });
  });
}

async function initialize() {
  applyTranslations();

  const elements = getElements();

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
    keepSameChatCheckbox: elements.keepSameChatCheckbox
  });

  workflowRunner = new WorkflowRunner({
    containerElement: elements.workflowSection,
    addLog,
    onStartWorkflow: () => {
      void handleStartWorkflow();
    }
  });

  questionProcessor = new QuestionProcessor({
    getSettings: () => ({ ...settingsPanel.getValues(), ...AppState.getState() }),
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
      keepSameChat: stored.keepSameChat
    });
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