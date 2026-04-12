import { AppState } from "./state/appState.js";
import {
  clearRemoteWorkflowSession,
  loadAll,
  loadLastRemoteStartRequestId,
  loadPendingMessage,
  loadRemoteWorkflowSession,
  removePendingMessage,
  saveQuestions,
  saveLastRemoteStartRequestId,
  saveRemoteWorkflowSession,
  saveSetting,
  saveWorkflows,
  saveWorkflowBackup,
  loadWorkflowBackups,
  StorageKeys,
} from "./services/storageService.js";
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
import { DebugLogger } from "./core/debugLogger.js";
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
let cachedProviders = { ...(globalThis.CONFIG?.PROVIDERS || {}) };
let isInitialized = false;
let lastHandledRemoteStartRequestId = "";
let aiStudioBridgeKeepAlivePort = null;
let aiStudioBridgeKeepAliveTimer = null;
let remoteWorkflowSessionClearTimer = null;

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

function normalizeLogLevel(level) {
  const value = typeof level === "string" ? level.trim().toLowerCase() : "info";
  const levelMap = {
    debug: "DEBUG",
    info: "INFO",
    success: "SUCCESS",
    warning: "WARNING",
    warn: "WARNING",
    error: "ERROR",
    critical: "CRITICAL"
  };

  return levelMap[value] || "INFO";
}

function buildQuestionSummary(questions = []) {
  return questions.reduce((summary, question) => {
    const status = question.status || "unknown";
    summary.total += 1;
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0
  });
}

function getCurrentQuestionForLogging(state) {
  if (!Array.isArray(state.questions) || state.questions.length === 0) {
    return null;
  }

  const processingQuestion = state.questions.find((question) => question.status === "processing");
  if (processingQuestion) {
    return processingQuestion;
  }

  const indexedQuestion = state.questions[state.currentIndex] || null;
  if (indexedQuestion && indexedQuestion.status !== "completed") {
    return indexedQuestion;
  }

  return state.questions.find((question) => ["pending", "failed"].includes(question.status)) || null;
}

function buildLogSnapshot(state) {
  const activeStep = state.activeWorkflow?.steps?.[state.activeWorkflowStepIndex] || null;

  return {
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    currentIndex: state.currentIndex,
    questionSummary: buildQuestionSummary(state.questions),
    activeWorkflow: state.activeWorkflow
      ? {
        id: state.activeWorkflow.id || "",
        name: state.activeWorkflow.name || "",
        totalSteps: Array.isArray(state.activeWorkflow.steps) ? state.activeWorkflow.steps.length : 0,
        currentStepIndex: state.activeWorkflowStepIndex,
        currentStepTitle: activeStep?.title || ""
      }
      : null,
    lastExtractedTextLength: String(state.lastExtractedText || "").length,
    settings: {
      useTempChat: state.useTempChat,
      useWebSearch: state.useWebSearch,
      keepSameChat: state.keepSameChat,
      humanTyping: state.humanTyping,
      randomDelays: state.randomDelays,
      biologicalPauses: state.biologicalPauses
    },
    remoteWorkflow: state.remoteWorkflowRequestId
      ? {
        requestId: state.remoteWorkflowRequestId,
        providerId: state.remoteWorkflowProviderId,
        projectFolder: state.remoteWorkflowProjectFolder,
        source: state.remoteWorkflowSource
      }
      : null
  };
}

function buildLogSystemSnapshot(state) {
  return {
    appState: {
      ...buildLogSnapshot(state),
      workflowContext: state.workflowContext
        ? {
          chainedTextLength: String(state.workflowContext.chainedText || "").length,
          stepResults: Array.isArray(state.workflowContext.stepResults)
            ? state.workflowContext.stepResults.map((result) => ({
              stepIndex: result.stepIndex,
              action: result.action,
              success: result.success === true,
              textLength: typeof result.text === "string" ? result.text.length : 0,
              textPreview: typeof result.text === "string" ? result.text.substring(0, 120) : ""
            }))
            : []
        }
        : null,
      questions: state.questions.map((question, index) => ({
        id: question.id,
        index,
        status: question.status,
        providerId: normalizeProviderId(question.stepProvider),
        questionPreview: String(question.question || "").substring(0, 120),
        answerLength: typeof question.answer === "string" ? question.answer.length : 0,
        sourcesCount: Array.isArray(question.sources) ? question.sources.length : 0,
        error: question.error || null,
        timestamp: question.timestamp || null,
        completedAt: question.completedAt || null
      })),
      workflows: state.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        stepCount: Array.isArray(workflow.steps) ? workflow.steps.length : 0
      }))
    },
    providers: Object.values(cachedProviders)
      .filter((provider) => provider && typeof provider === "object")
      .map((provider) => ({
        id: provider.id || "",
        label: provider.label || provider.id || "",
        hostname: provider.HOSTNAME || "",
        supportsSSE: provider.supportsSSE === true,
        supportsWebSearch: provider.supportsWebSearch === true,
        supportsTempChat: provider.supportsTempChat === true,
        supportsLivePolling: provider.supportsLivePolling === true
      }))
  };
}

function buildLoggerContext() {
  const state = AppState.getState();
  const currentQuestion = getCurrentQuestionForLogging(state);
  const activeStep = state.activeWorkflow?.steps?.[state.activeWorkflowStepIndex] || null;
  const providerId = currentQuestion ? normalizeProviderId(currentQuestion.stepProvider) : null;

  return {
    workflowContext: state.activeWorkflow
      ? {
        workflowId: state.activeWorkflow.id || "",
        workflowName: state.activeWorkflow.name || "",
        stepIndex: state.activeWorkflowStepIndex,
        stepTitle: activeStep?.title || `Step ${state.activeWorkflowStepIndex + 1}`
      }
      : null,
    questionContext: currentQuestion
      ? {
        questionId: currentQuestion.id,
        questionPreview: String(currentQuestion.question || "").substring(0, 60),
        providerId,
        providerLabel: getProviderLabel(providerId),
        status: currentQuestion.status
      }
      : null,
    snapshot: buildLogSnapshot(state),
    systemSnapshot: buildLogSystemSnapshot(state)
  };
}

function addLog(message, level = "info", metadata = {}) {
  const normalizedMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
  const entryMetadata = {
    source: "sidepanel",
    category: "SYSTEM",
    ...normalizedMetadata
  };

  if (logPanel) {
    return logPanel.add(message, level, entryMetadata);
  }

  return DebugLogger.log(normalizeLogLevel(level), message, entryMetadata);
}

function addWorkflowLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "workflowRunner",
    category: "WORKFLOW",
    ...metadata
  });
}

function addQuestionLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "questionQueue",
    category: "QUESTION",
    ...metadata
  });
}

function addProviderLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "providerRouter",
    category: "PROVIDER",
    ...metadata
  });
}

function addBridgeLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "bridge",
    category: "BRIDGE",
    ...metadata
  });
}

function addStorageLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "storage",
    category: "STORAGE",
    ...metadata
  });
}

function addUILog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "ui",
    category: "UI",
    ...metadata
  });
}

function addSystemLog(message, level = "info", metadata = {}) {
  return addLog(message, level, {
    source: "sidepanel",
    category: "SYSTEM",
    ...metadata
  });
}

function persistQuestions() {
  return saveQuestions(AppState.getState().questions);
}

function stopAiStudioBridgeKeepAlive() {
  if (aiStudioBridgeKeepAliveTimer) {
    clearInterval(aiStudioBridgeKeepAliveTimer);
    aiStudioBridgeKeepAliveTimer = null;
  }

  if (aiStudioBridgeKeepAlivePort) {
    try {
      aiStudioBridgeKeepAlivePort.disconnect();
    } catch {
    }
    aiStudioBridgeKeepAlivePort = null;
  }
}

function postAiStudioBridgeHeartbeat() {
  if (!aiStudioBridgeKeepAlivePort) {
    return;
  }

  try {
    const state = AppState.getState();
    aiStudioBridgeKeepAlivePort.postMessage({
      type: "AI_STUDIO_SIDEPANEL_HEARTBEAT",
      timestamp: Date.now(),
      remoteWorkflowRequestId: state.remoteWorkflowRequestId || "",
      remoteWorkflowProviderId: state.remoteWorkflowProviderId || "",
      hasActiveWorkflow: Boolean(state.activeWorkflow),
    });
  } catch {
  }
}

function startAiStudioBridgeKeepAlive() {
  stopAiStudioBridgeKeepAlive();

  try {
    aiStudioBridgeKeepAlivePort = chrome.runtime.connect({ name: "aiStudioSidepanel" });
  } catch {
    aiStudioBridgeKeepAlivePort = null;
    return;
  }

  aiStudioBridgeKeepAlivePort.onDisconnect.addListener(() => {
    if (aiStudioBridgeKeepAliveTimer) {
      clearInterval(aiStudioBridgeKeepAliveTimer);
      aiStudioBridgeKeepAliveTimer = null;
    }

    aiStudioBridgeKeepAlivePort = null;
    setTimeout(() => {
      if (isInitialized) {
        startAiStudioBridgeKeepAlive();
      }
    }, 1000);
  });

  postAiStudioBridgeHeartbeat();
  aiStudioBridgeKeepAliveTimer = setInterval(postAiStudioBridgeHeartbeat, 20000);
}

function normalizeProviderId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "chatgpt";
}

function cancelRemoteWorkflowSessionClear() {
  if (!remoteWorkflowSessionClearTimer) {
    return;
  }

  clearTimeout(remoteWorkflowSessionClearTimer);
  remoteWorkflowSessionClearTimer = null;
}

function scheduleRemoteWorkflowSessionClear(delayMs = 8000) {
  cancelRemoteWorkflowSessionClear();
  remoteWorkflowSessionClearTimer = setTimeout(() => {
    remoteWorkflowSessionClearTimer = null;
    void clearRemoteWorkflowSession();
  }, delayMs);
}

function getRemoteWorkflowProviderId(workflow = AppState.getState().activeWorkflow) {
  const state = AppState.getState();
  if (state.remoteWorkflowProviderId) {
    return normalizeProviderId(state.remoteWorkflowProviderId);
  }

  const firstStepProvider = Array.isArray(workflow?.steps)
    ? workflow.steps.find((step) => typeof step?.provider === "string" && step.provider.trim())?.provider
    : "";

  return normalizeProviderId(firstStepProvider || "aistudio");
}

async function clearPersistedRemoteWorkflowSession() {
  cancelRemoteWorkflowSessionClear();
  await clearRemoteWorkflowSession();
}

async function persistRemoteWorkflowSession(status, payload = {}) {
  cancelRemoteWorkflowSessionClear();

  const state = AppState.getState();
  const workflow = payload.workflow || state.activeWorkflow || null;
  const requestId = payload.requestId || state.remoteWorkflowRequestId;
  const workflowId = payload.workflowId || workflow?.id || "";

  if (!requestId || !workflowId) {
    await clearPersistedRemoteWorkflowSession();
    return null;
  }

  const totalSteps = typeof payload.totalSteps === "number"
    ? payload.totalSteps
    : Array.isArray(workflow?.steps)
      ? workflow.steps.length
      : 0;

  const session = {
    requestId,
    workflowId,
    workflowName: payload.workflowName || workflow?.name || "",
    providerId: normalizeProviderId(payload.providerId || getRemoteWorkflowProviderId(workflow)),
    status: typeof status === "string" && status.trim() ? status.trim() : "started",
    stepIndex: typeof payload.stepIndex === "number"
      ? payload.stepIndex
      : typeof state.activeWorkflowStepIndex === "number"
        ? state.activeWorkflowStepIndex
        : -1,
    stepTitle: payload.stepTitle || "",
    totalSteps,
    message: payload.message || "",
    source: payload.source || state.remoteWorkflowSource || "",
    updatedAt: Date.now(),
  };

  await saveRemoteWorkflowSession(session);
  return session;
}

function updateCachedProviders(providerMap) {
  const fallbackProviders = globalThis.CONFIG?.PROVIDERS || {};

  if (!providerMap || typeof providerMap !== "object" || Array.isArray(providerMap)) {
    cachedProviders = { ...fallbackProviders };
    return;
  }

  cachedProviders = {
    ...fallbackProviders,
    ...providerMap
  };
}

async function refreshProviderCatalog() {
  try {
    const providers = await sendToBackground({ type: "GET_ALL_PROVIDERS" });
    updateCachedProviders(providers);
  } catch {
    updateCachedProviders(globalThis.CONFIG?.PROVIDERS || {});
  }
}

function getProviderLabel(providerId = "chatgpt") {
  const normalizedId = normalizeProviderId(providerId);
  return cachedProviders[normalizedId]?.label
    || globalThis.CONFIG?.PROVIDERS?.[normalizedId]?.label
    || normalizedId;
}

function getPendingProviderId(questions = []) {
  const pendingQuestion = questions.find((question) => {
    if (!["pending", "failed", "processing"].includes(question.status)) {
      return false;
    }

    return typeof question.stepProvider === "string" && question.stepProvider.trim();
  });

  return normalizeProviderId(pendingQuestion?.stepProvider);
}

function logProviderOpenFailure(providerId, error) {
  addProviderLog(
    `${t("messages.cannotOpenProvider", { provider: getProviderLabel(providerId) })}: ${error?.message || error || "Unknown error"}`,
    "error",
    {
      details: {
        providerId,
        providerLabel: getProviderLabel(providerId),
        error: error?.message || error || "Unknown error"
      }
    }
  );
}

async function openProviderTab(providerId, options = {}) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const providerLabel = getProviderLabel(normalizedProviderId);

  addProviderLog(t("messages.openingProvider", { provider: providerLabel }), "info", {
    details: {
      providerId: normalizedProviderId,
      providerLabel,
      useTempChat: options.useTempChat !== false,
      useWebSearch: options.useWebSearch !== false,
      keepSameChat: options.keepSameChat === true
    }
  });

  const response = await sendToBackground({
    type: "OPEN_CHATGPT",
    providerId: normalizedProviderId,
    ...options
  });

  if (!response?.success) {
    throw new Error(response?.error || "Unknown error");
  }

  return {
    providerId: normalizedProviderId,
    providerLabel,
    response
  };
}

async function emitRemoteWorkflowEvent(status, payload = {}) {
  const state = AppState.getState();
  const requestId = payload.requestId || state.remoteWorkflowRequestId;
  if (!requestId) {
    return false;
  }

  const workflow = payload.workflow || state.activeWorkflow || null;
  const totalSteps = typeof payload.totalSteps === "number"
    ? payload.totalSteps
    : Array.isArray(workflow?.steps)
      ? workflow.steps.length
      : 0;

  try {
    await sendToBackground({
      type: "WORKFLOW_REMOTE_EVENT",
      status,
      requestId,
      workflowId: payload.workflowId || workflow?.id || "",
      workflowName: payload.workflowName || workflow?.name || "",
      providerId: payload.providerId || getRemoteWorkflowProviderId(workflow),
      stepIndex: typeof payload.stepIndex === "number" ? payload.stepIndex : undefined,
      stepTitle: payload.stepTitle || "",
      totalSteps,
      message: payload.message || ""
    });
    return true;
  } catch {
    return false;
  }
}

function getWorkflowResetPatch() {
  return {
    isRunning: false,
    isPaused: false,
    processedSincePause: 0,
    lastExtractedText: "",
    activeWorkflow: null,
    activeWorkflowStepIndex: -1,
    workflowContext: null,
    remoteWorkflowRequestId: "",
    remoteWorkflowProviderId: "",
    remoteWorkflowProjectFolder: "",
    remoteWorkflowSource: ""
  };
}

async function handleRemoteWorkflowStart(message) {
  const requestId = typeof message.requestId === "string" ? message.requestId.trim() : "";
  const requestedWorkflowId = typeof message.workflowId === "string" ? message.workflowId.trim() : "";

  if (requestId && requestId === lastHandledRemoteStartRequestId) {
    return true;
  }

  if (!isInitialized || !workflowRunner || AppState.getState().workflows.length === 0) {
    return false;
  }

  if (requestId) {
    lastHandledRemoteStartRequestId = requestId;
    await saveLastRemoteStartRequestId(requestId);
  }

  const workflow = workflowRunner.selectWorkflow(requestedWorkflowId);
  if (!workflow) {
    const workflowName = typeof message.workflowName === "string" ? message.workflowName : requestedWorkflowId;
    addBridgeLog(`No se encontró el workflow remoto solicitado: ${workflowName || "(sin id)"}.`, "error", {
      details: {
        requestId,
        workflowId: requestedWorkflowId,
        workflowName
      }
    });
    await emitRemoteWorkflowEvent("failed", {
      requestId,
      workflowId: requestedWorkflowId,
      workflowName,
      message: "No se encontró el workflow remoto solicitado en el sidepanel."
    });
    return true;
  }

  await handleStartWorkflow({
    workflowId: workflow.id,
    source: "remote",
    bridgeRequestId: requestId,
    remoteWorkflowName: workflow.name,
    providerId: typeof message.providerId === "string" ? message.providerId : "aistudio"
  });
  return true;
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
  const providerId = getPendingProviderId(sanitizedQuestions);

  try {
    const { useTempChat, useWebSearch, keepSameChat } = settingsPanel.getValues();
    await openProviderTab(providerId, {
      useTempChat,
      useWebSearch,
      keepSameChat
    });
  } catch (error) {
    logProviderOpenFailure(providerId, error);
    return;
  }

  const antiBotSettings = AppState.getState();

  AppState.patch({
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    processedSincePause: 0,
    lastExtractedText: "",
    remoteWorkflowRequestId: "",
    remoteWorkflowProjectFolder: "",
    remoteWorkflowSource: ""
  });
  addLog(t("messages.startingBatch"), "info");
  addLog(t("messages.foundPending", { count: pendingQuestions.length }), "info");
  addLog(t("messages.waitingProviderPage", { provider: getProviderLabel(providerId) }), "info");

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

async function handleStartWorkflow(options = {}) {
  const {
    workflowId = "",
    source = "manual",
    bridgeRequestId = "",
    remoteWorkflowName = "",
    providerId = "",
    projectFolder = "",
  } = options;
  const isRemote = source === "remote";
  const state = AppState.getState();
  const normalizedRemoteProviderId = normalizeProviderId(providerId || "aistudio");

  const failWorkflowStart = async (message, level = "error", workflow = null) => {
    addWorkflowLog(message, level, {
      details: {
        workflowId: workflow?.id || workflowId || "",
        workflowName: workflow?.name || remoteWorkflowName || "",
        source,
        requestId: bridgeRequestId || "",
        providerId: normalizedRemoteProviderId
      }
    });
    if (isRemote) {
      await persistRemoteWorkflowSession("failed", {
        requestId: bridgeRequestId,
        workflowId: workflow?.id || workflowId || "",
        workflowName: workflow?.name || remoteWorkflowName || "",
        workflow,
        providerId: normalizedRemoteProviderId,
        message,
      });
      scheduleRemoteWorkflowSessionClear();
      await emitRemoteWorkflowEvent("failed", {
        requestId: bridgeRequestId,
        workflowId: workflow?.id || workflowId || "",
        workflowName: workflow?.name || remoteWorkflowName || "",
        providerId: normalizedRemoteProviderId,
        message
      });
    }
    return false;
  };

  if (state.isRunning || state.activeWorkflow) {
    return failWorkflowStart(t("messages.alreadyRunning"), "warning");
  }

  const workflow = workflowId
    ? workflowRunner.getWorkflowById(workflowId)
    : workflowRunner.getSelectedWorkflow();
  if (!workflow) {
    return failWorkflowStart(t("messages.workflowSelectRequired"), "warning");
  }

  if (workflowId) {
    workflowRunner.selectWorkflow(workflow.id);
  }

  if (workflow.steps.length === 0) {
    return failWorkflowStart(t("messages.workflowNoSteps"), "warning", workflow);
  }

  // Auto-backup the workflow snapshot before execution (fire-and-forget)
  void saveWorkflowBackup(workflow);

  // Clear existing questions before starting the workflow
  AppState.setQuestions([]);
  await persistQuestions();

  addWorkflowLog(t("messages.workflowStarting", { name: workflow.name }), "info", {
    details: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      source,
      requestId: bridgeRequestId || "",
      totalSteps: workflow.steps.length
    }
  });

  AppState.patch({
    activeWorkflow: { ...workflow },
    activeWorkflowStepIndex: 0,
    workflowContext: {
      chainedText: "",
      stepResults: []
    },
    remoteWorkflowRequestId: isRemote ? bridgeRequestId : "",
    remoteWorkflowProviderId: isRemote ? normalizedRemoteProviderId : "",
    remoteWorkflowProjectFolder: isRemote ? String(projectFolder || "").trim() : "",
    remoteWorkflowSource: isRemote ? "remote" : ""
  });

  if (isRemote) {
    await persistRemoteWorkflowSession("started", {
      requestId: bridgeRequestId,
      workflow,
      workflowName: workflow.name,
      providerId: normalizedRemoteProviderId,
      totalSteps: workflow.steps.length,
      message: `Workflow ${workflow.name} iniciado en el sidepanel.`,
    });
    await emitRemoteWorkflowEvent("started", {
      requestId: bridgeRequestId,
      workflow,
      workflowName: workflow.name,
      providerId: normalizedRemoteProviderId,
      totalSteps: workflow.steps.length,
      message: `Workflow ${workflow.name} iniciado en el sidepanel.`
    });
  } else {
    void clearPersistedRemoteWorkflowSession();
  }

  await executeWorkflowStep(0);
  return true;
}

async function executeWorkflowStep(stepIndex) {
  const state = AppState.getState();
  const workflow = state.activeWorkflow;

  if (!workflow || stepIndex >= workflow.steps.length) {
    addWorkflowLog(t("messages.workflowComplete"), "success", {
      details: {
        workflowId: workflow?.id || "",
        workflowName: workflow?.name || "",
        totalSteps: Array.isArray(workflow?.steps) ? workflow.steps.length : 0
      }
    });
    AppState.patch(getWorkflowResetPatch());
    return;
  }

  const step = workflow.steps[stepIndex];
  const stepTitle = step.title || `Step ${stepIndex + 1}`;

  AppState.patch({ activeWorkflowStepIndex: stepIndex });
  addWorkflowLog(t("messages.workflowStepStarting", [stepIndex + 1, stepTitle]), "info", {
    details: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepIndex,
      stepTitle,
      providerId: normalizeProviderId(step.provider)
    }
  });
  await persistRemoteWorkflowSession("step_started", {
    workflow,
    providerId: getRemoteWorkflowProviderId(workflow),
    stepIndex,
    stepTitle,
    totalSteps: workflow.steps.length,
    message: `Iniciando ${stepTitle}.`,
  });
  await emitRemoteWorkflowEvent("step_started", {
    workflow,
    stepIndex,
    stepTitle,
    providerId: getRemoteWorkflowProviderId(workflow),
    totalSteps: workflow.steps.length,
    message: `Iniciando ${stepTitle}.`
  });

  // Get the chainedText from the workflow context
  const chainedText = state.workflowContext?.chainedText || "";
  if (chainedText && stepIndex > 0) {
    addWorkflowLog(`Chained data available (${chainedText.length} chars)`, "info", {
      category: "EXTRACTION",
      details: {
        stepIndex,
        stepTitle,
        chainedTextLength: chainedText.length
      }
    });
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
        addBridgeLog("External source has no title ready. Run clusiv-v3 analysis first.", "warning", {
          details: {
            stepIndex,
            stepTitle,
            url: extSrc.url || "http://localhost:7788/api/best-title",
            responseStatus: data.status || "unknown"
          }
        });
        abortWorkflow();
        return;
      }
      effectiveChainedText = data.title;
      addBridgeLog(`External title fetched: "${effectiveChainedText}"`, "info", {
        details: {
          stepIndex,
          stepTitle,
          titleLength: effectiveChainedText.length,
          url: extSrc.url || "http://localhost:7788/api/best-title"
        }
      });
    } catch (err) {
      addBridgeLog(`External source fetch failed: ${err.message}`, "error", {
        details: {
          stepIndex,
          stepTitle,
          url: extSrc.url || "http://localhost:7788/api/best-title",
          error: err.message
        }
      });
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
  addQuestionLog(`${addedCount} ${t("messages.questionsAdded")}`, "success", {
    details: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepIndex,
      stepTitle,
      addedCount,
      providerId: normalizeProviderId(step.provider)
    }
  });
  const providerId = normalizeProviderId(step.provider);
  let providerLabel = getProviderLabel(providerId);

  try {
    const { useTempChat, useWebSearch, keepSameChat } = settingsPanel.getValues();
    const openedProvider = await openProviderTab(providerId, {
      useTempChat,
      useWebSearch,
      keepSameChat
    });
    providerLabel = openedProvider.providerLabel;
  } catch (error) {
    logProviderOpenFailure(providerId, error);
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

  addQuestionLog(t("messages.startingBatch"), "info", {
    details: {
      pendingQuestions: pendingQuestions.length,
      providerId,
      providerLabel,
      workflowId: workflow.id,
      stepIndex
    }
  });
  addQuestionLog(t("messages.foundPending", { count: pendingQuestions.length }), "info", {
    details: {
      pendingQuestions: pendingQuestions.length,
      stepIndex,
      stepTitle
    }
  });
  addProviderLog(t("messages.waitingProviderPage", { provider: providerLabel }), "info", {
    details: {
      providerId,
      providerLabel,
      stepIndex,
      stepTitle
    }
  });

  const antiBotSettings = AppState.getState();
  await waitForConfiguredDelay(AppConfig.TIMING.BETWEEN_QUESTIONS_MS, antiBotSettings.randomDelays);
  addQuestionLog(t("messages.startingFirst"), "info", {
    details: {
      providerId,
      providerLabel,
      stepIndex,
      stepTitle
    }
  });
  void questionProcessor.processNextQuestion();
}

async function advanceWorkflowStep() {
  const state = AppState.getState();
  if (!state.activeWorkflow) {
    return;
  }

  const nextStepIndex = state.activeWorkflowStepIndex + 1;
  const currentStep = state.activeWorkflow.steps[state.activeWorkflowStepIndex] || null;
  const currentStepTitle = currentStep?.title || `Step ${state.activeWorkflowStepIndex + 1}`;
  await persistRemoteWorkflowSession("step_completed", {
    workflow: state.activeWorkflow,
    providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
    stepIndex: state.activeWorkflowStepIndex,
    stepTitle: currentStepTitle,
    totalSteps: state.activeWorkflow.steps.length,
    message: `Completado ${currentStepTitle}.`,
  });
  await emitRemoteWorkflowEvent("step_completed", {
    workflow: state.activeWorkflow,
    stepIndex: state.activeWorkflowStepIndex,
    stepTitle: currentStepTitle,
    providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
    totalSteps: state.activeWorkflow.steps.length,
    message: `Completado ${currentStepTitle}.`
  });
  addWorkflowLog(t("messages.workflowStepComplete", { num: state.activeWorkflowStepIndex + 1 }), "success", {
    details: {
      workflowId: state.activeWorkflow.id,
      workflowName: state.activeWorkflow.name,
      stepIndex: state.activeWorkflowStepIndex,
      stepTitle: currentStepTitle
    }
  });

  if (nextStepIndex >= state.activeWorkflow.steps.length) {
    addWorkflowLog(t("messages.workflowComplete"), "success", {
      details: {
        workflowId: state.activeWorkflow.id,
        workflowName: state.activeWorkflow.name,
        totalSteps: state.activeWorkflow.steps.length
      }
    });

    const totalStoredSteps = countStoredSteps(state.activeWorkflow);
    if (totalStoredSteps === 0) {
      addBridgeLog("Workflow completed without any 'Store full response' steps. Teleprompter merge was skipped.", "warning", {
        details: {
          workflowId: state.activeWorkflow.id,
          workflowName: state.activeWorkflow.name,
          totalStoredSteps
        }
      });
      await persistRemoteWorkflowSession("completed", {
        workflow: state.activeWorkflow,
        providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
        totalSteps: state.activeWorkflow.steps.length,
        message: `Workflow ${state.activeWorkflow.name} completado.`,
      });
      await emitRemoteWorkflowEvent("completed", {
        workflow: state.activeWorkflow,
        providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
        totalSteps: state.activeWorkflow.steps.length,
        message: `Workflow ${state.activeWorkflow.name} completado.`
      });
      scheduleRemoteWorkflowSessionClear();
      AppState.patch(getWorkflowResetPatch());
      return;
    }

    // Notify clusiv-v3 to merge teleprompter scripts (fire-and-warn, never aborts workflow)
    try {
      const resp = await fetch("http://localhost:7788/api/workflow-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowName: state.activeWorkflow.name,
          requestId: state.remoteWorkflowRequestId || "",
          projectFolder: state.remoteWorkflowProjectFolder || "",
          totalStoredSteps,
          totalSteps: totalStoredSteps
        })
      });
      if (!resp.ok) {
        const raw = await resp.text();
        addBridgeLog(`clusiv-v3 responded ${resp.status}: ${raw || "(sin cuerpo)"}`, "warning", {
          details: {
            workflowId: state.activeWorkflow.id,
            workflowName: state.activeWorkflow.name,
            status: resp.status,
            body: raw || ""
          }
        });
      } else {
        const data = await resp.json();
        if (data.success) {
          addBridgeLog(`Teleprompter script guardado en: ${data.path} (${data.blocksFound} bloques)`, "success", {
            details: {
              workflowId: state.activeWorkflow.id,
              workflowName: state.activeWorkflow.name,
              path: data.path,
              blocksFound: data.blocksFound
            }
          });
        } else {
          addBridgeLog(`No se pudo generar el script: ${data.error}`, "warning", {
            details: {
              workflowId: state.activeWorkflow.id,
              workflowName: state.activeWorkflow.name,
              error: data.error
            }
          });
        }
      }
    } catch (err) {
      addBridgeLog(`No se pudo conectar a clusiv-v3: ${err.message}`, "warning", {
        details: {
          workflowId: state.activeWorkflow.id,
          workflowName: state.activeWorkflow.name,
          error: err.message
        }
      });
    }

    await persistRemoteWorkflowSession("completed", {
      workflow: state.activeWorkflow,
      providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
      totalSteps: state.activeWorkflow.steps.length,
      message: `Workflow ${state.activeWorkflow.name} completado.`,
    });
    await emitRemoteWorkflowEvent("completed", {
      workflow: state.activeWorkflow,
      providerId: getRemoteWorkflowProviderId(state.activeWorkflow),
      totalSteps: state.activeWorkflow.steps.length,
      message: `Workflow ${state.activeWorkflow.name} completado.`
    });
    scheduleRemoteWorkflowSessionClear();
    AppState.patch(getWorkflowResetPatch());
    return;
  }

  await executeWorkflowStep(nextStepIndex);
}

async function abortWorkflow(status = "aborted", options = {}) {
  const state = AppState.getState();
  const workflow = options.workflow || state.activeWorkflow;
  const requestId = options.requestId || state.remoteWorkflowRequestId;
  const workflowName = options.workflowName || workflow?.name || "activo";
  const message = options.message || `Workflow ${workflowName} abortado en el sidepanel.`;
  const statusLevel = status === "failed" ? "error" : "warning";

  await persistRemoteWorkflowSession(status, {
    requestId,
    workflow,
    workflowId: options.workflowId || workflow?.id || "",
    workflowName,
    providerId: options.providerId || getRemoteWorkflowProviderId(workflow),
    stepIndex: typeof options.stepIndex === "number" ? options.stepIndex : state.activeWorkflowStepIndex,
    stepTitle: options.stepTitle || "",
    totalSteps: typeof options.totalSteps === "number"
      ? options.totalSteps
      : Array.isArray(workflow?.steps)
        ? workflow.steps.length
        : 0,
    message,
  });

  await emitRemoteWorkflowEvent(status, {
    requestId,
    workflow,
    workflowId: options.workflowId || workflow?.id || "",
    workflowName,
    providerId: options.providerId || getRemoteWorkflowProviderId(workflow),
    stepIndex: typeof options.stepIndex === "number" ? options.stepIndex : state.activeWorkflowStepIndex,
    stepTitle: options.stepTitle || "",
    totalSteps: typeof options.totalSteps === "number"
      ? options.totalSteps
      : Array.isArray(workflow?.steps)
        ? workflow.steps.length
        : 0,
    message,
  });

  scheduleRemoteWorkflowSessionClear();
  addWorkflowLog(options.logMessage || "Workflow aborted.", statusLevel, {
    details: {
      status,
      requestId,
      workflowId: workflow?.id || options.workflowId || "",
      workflowName,
      providerId: options.providerId || getRemoteWorkflowProviderId(workflow),
      stepIndex: typeof options.stepIndex === "number" ? options.stepIndex : state.activeWorkflowStepIndex,
      stepTitle: options.stepTitle || "",
      source: options.source || "sidepanel"
    }
  });
  AppState.patch(getWorkflowResetPatch());
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

function handleStop(options = {}) {
  const state = AppState.getState();
  const source = options.source || "manual";
  const isRemoteStop = source === "remote";

  if (state.activeWorkflow || state.remoteWorkflowRequestId) {
    void abortWorkflow("aborted", {
      requestId: options.requestId || state.remoteWorkflowRequestId,
      workflow: state.activeWorkflow,
      providerId: options.providerId || state.remoteWorkflowProviderId || "",
      message: options.message || (
        isRemoteStop
          ? `Workflow ${state.activeWorkflow?.name || "activo"} detenido por solicitud remota.`
          : `Workflow ${state.activeWorkflow?.name || "activo"} detenido manualmente.`
      ),
      logMessage: isRemoteStop
        ? "Workflow remoto detenido por solicitud del orquestador."
        : t("messages.executionStopped"),
    });
    return;
  }

  void clearPersistedRemoteWorkflowSession();
  AppState.patch(getWorkflowResetPatch());
  addLog(t("messages.executionStopped"), "warning");
}

async function handleRemoteWorkflowStop(message) {
  const requestedWorkflowRequestId = typeof message.workflowRequestId === "string"
    ? message.workflowRequestId.trim()
    : "";
  const state = AppState.getState();
  const activeWorkflowRequestId = state.remoteWorkflowRequestId;

  if (activeWorkflowRequestId && requestedWorkflowRequestId && requestedWorkflowRequestId !== activeWorkflowRequestId) {
    return false;
  }

  if (state.activeWorkflow || activeWorkflowRequestId) {
    handleStop({
      source: "remote",
      requestId: requestedWorkflowRequestId || activeWorkflowRequestId,
      providerId: state.remoteWorkflowProviderId || "",
      message: `Workflow ${state.activeWorkflow?.name || "activo"} detenido por el bridge remoto.`,
    });
    return true;
  }

  const storedSession = await loadRemoteWorkflowSession();
  if (!storedSession) {
    return false;
  }

  if (requestedWorkflowRequestId && storedSession.requestId !== requestedWorkflowRequestId) {
    return false;
  }

  await emitRemoteWorkflowEvent("aborted", {
    requestId: storedSession.requestId,
    workflowId: storedSession.workflowId,
    workflowName: storedSession.workflowName,
    providerId: storedSession.providerId,
    stepIndex: storedSession.stepIndex,
    stepTitle: storedSession.stepTitle,
    totalSteps: storedSession.totalSteps,
    message: storedSession.message || `Workflow ${storedSession.workflowName || storedSession.workflowId || "activo"} detenido por el bridge remoto.`,
  });
  await clearPersistedRemoteWorkflowSession();
  return true;
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

async function processSidePanelMessage(message, { fromStorage = false } = {}) {
  if (!message) {
    return false;
  }

  if (message.type === "REMOTE_START_WORKFLOW") {
    if (!isInitialized) {
      return false;
    }

    const handled = await handleRemoteWorkflowStart(message);
    if (handled && fromStorage && message.timestamp) {
      AppState.patch({ lastProcessedMessageTimestamp: message.timestamp });
    }
    return handled;
  }

  if (message.type === "REMOTE_STOP_WORKFLOW") {
    if (!isInitialized) {
      return false;
    }

    const handled = await handleRemoteWorkflowStop(message);
    if (handled && fromStorage && message.timestamp) {
      AppState.patch({ lastProcessedMessageTimestamp: message.timestamp });
    }
    return handled;
  }

  if (fromStorage) {
    const state = AppState.getState();
    if (message.timestamp && message.timestamp <= state.lastProcessedMessageTimestamp) {
      return true;
    }
    if (message.timestamp) {
      AppState.patch({ lastProcessedMessageTimestamp: message.timestamp });
    }
  }

  switch (message.type) {
    case "QUESTION_COMPLETE":
      await questionProcessor.handleQuestionComplete(message.result);
      return true;
    case "UPDATE_PROGRESS":
      return true;
    case "LOG_MESSAGE":
      addLog(message.message, message.level || "info", {
        category: message.category || "SYSTEM",
        source: message.source || "background",
        details: message.details || null
      });
      return true;
    default:
      return false;
  }
}

function wireMessageListeners() {
  onRuntimeMessage((message, _sender, sendResponse) => {
    if (message.type === "REMOTE_START_WORKFLOW") {
      if (!isInitialized) {
        sendResponse({ received: false, pending: true });
        return false;
      }

      void handleRemoteWorkflowStart(message)
        .then((handled) => sendResponse({ received: handled }))
        .catch(() => sendResponse({ received: false }));
      return true;
    }

    if (message.type === "REMOTE_STOP_WORKFLOW") {
      if (!isInitialized) {
        sendResponse({ received: false, pending: true });
        return false;
      }

      void handleRemoteWorkflowStop(message)
        .then((handled) => sendResponse({ received: handled }))
        .catch(() => sendResponse({ received: false }));
      return true;
    }

    switch (message.type) {
      case "QUESTION_COMPLETE":
        void questionProcessor.handleQuestionComplete(message.result);
        sendResponse({ received: true });
        return false;
      case "UPDATE_PROGRESS":
        sendResponse({ received: true });
        return false;
      case "LOG_MESSAGE":
        addLog(message.message, message.level || "info", {
          category: message.category || "SYSTEM",
          source: message.source || "background",
          details: message.details || null
        });
        sendResponse({ received: true });
        return false;
      default:
        return false;
    }
  });

  // Reload workflows when the external workflow editor modifies them
  onStorageChange((changes) => {
    if (changes.savedWorkflows) {
      const rawWorkflows = changes.savedWorkflows.newValue;
      const normalized = normalizeWorkflows(rawWorkflows);
      AppState.patch({ workflows: normalized });
    }
    if (changes.customProviders || changes.builtinProviderOverrides) {
      void refreshProviderCatalog();
    }
    if (!changes.pendingMessage) {
      return;
    }

    const pendingMessage = changes.pendingMessage.newValue;
    if (!pendingMessage) {
      return;
    }

    void processSidePanelMessage(pendingMessage, { fromStorage: true }).then((handled) => {
      if (handled) {
        void removePendingMessage();
      }
    });
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

  DebugLogger.setContextProvider(buildLoggerContext);
  DebugLogger.setMaxEntries(AppConfig.LOG_MAX_ENTRIES);
  logPanel = new LogPanel(elements.logContainer);
  DebugLogger.startSession();
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

  await refreshProviderCatalog();

  workflowRunner = new WorkflowRunner({
    containerElement: elements.workflowSection,
    addLog: (message, level = "info", metadata = {}) => addWorkflowLog(message, level, metadata),
    onStartWorkflow: () => {
      void handleStartWorkflow();
    }
  });

  questionProcessor = new QuestionProcessor({
    getSettings: () => ({ ...settingsPanel.getValues(), ...AppState.getState() }),
    addLog: (message, level = "info", metadata = {}) => addLog(message, level, {
      source: "questionProcessor",
      category: "QUESTION",
      ...metadata
    }),
    getProviderLabel,
    onAllCompleted: () => {
      void advanceWorkflowStep();
    },
    onWorkflowAbort: () => {
      abortWorkflow();
    }
  });

  setupEventListeners(elements);
  wireMessageListeners();
  startAiStudioBridgeKeepAlive();

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
      addStorageLog(t("messages.loadedQuestions", { count: stored.questions.length }), "info", {
        details: {
          count: stored.questions.length
        }
      });
    }
  } catch (error) {
    addStorageLog(`${t("messages.loadFailed")}: ${error.message}`, "error", {
      details: {
        error: error.message
      }
    });
  }

  try {
    const [storedLastRemoteStartRequestId, storedSession] = await Promise.all([
      loadLastRemoteStartRequestId(),
      loadRemoteWorkflowSession()
    ]);
    const sessionRequestId = typeof storedSession?.requestId === "string"
      ? storedSession.requestId.trim()
      : "";
    lastHandledRemoteStartRequestId = storedLastRemoteStartRequestId.trim() || sessionRequestId;
  } catch {
  }

  isInitialized = true;

  try {
    const pendingMessage = await loadPendingMessage();
    if (pendingMessage) {
      const handled = await processSidePanelMessage(pendingMessage, { fromStorage: true });
      if (handled) {
        await removePendingMessage();
      }
    }
  } catch {
  }

  questionList.render();
  controlPanel.render();
  statsPanel.render();
  addSystemLog(t("messages.ready"), "success", {
    details: {
      providerCount: Object.keys(cachedProviders).length,
      workflowCount: AppState.getState().workflows.length
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

window.addEventListener("beforeunload", () => {
  stopAiStudioBridgeKeepAlive();
});