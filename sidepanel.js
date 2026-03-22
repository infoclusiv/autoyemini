const BROWSER_LANG = chrome.i18n.getUILanguage().toLowerCase().startsWith("zh")
  ? "zh"
  : "en";

const KEY_MAP = {
  title: "title",
  "input.title": "inputTitle",
  "input.placeholder": "inputPlaceholder",
  "input.addBtn": "inputAddBtn",
  "input.clearBtn": "inputClearBtn",
  "control.title": "controlTitle",
  "control.startBtn": "controlStartBtn",
  "control.pauseBtn": "controlPauseBtn",
  "control.resumeBtn": "controlResumeBtn",
  "control.stopBtn": "controlStopBtn",
  "control.retryBtn": "controlRetryBtn",
  "control.useTempChat": "controlUseTempChat",
  "control.useTempChatHint": "controlUseTempChatHint",
  "control.useWebSearch": "controlUseWebSearch",
  "control.useWebSearchHint": "controlUseWebSearchHint",
  "stats.total": "statsTotal",
  "stats.completed": "statsCompleted",
  "stats.success": "statsSuccess",
  "stats.failed": "statsFailed",
  "progress.ready": "progressReady",
  "progress.running": "progressRunning",
  "progress.processing": "progressProcessing",
  "progress.paused": "progressPaused",
  "progress.completed": "progressCompleted",
  "log.title": "logTitle",
  "questions.title": "questionsTitle",
  "questions.exportBtn": "questionsExportBtn",
  "questions.clearBtn": "questionsClearBtn",
  "questions.question": "questionsQuestion",
  "questions.answer": "questionsAnswer",
  "questions.sources": "questionsSources",
  "questions.noQuestions": "questionsNoQuestions",
  "questions.addToStart": "questionsAddToStart",
  "questions.noAnswer": "questionsNoAnswer",
  "questions.errorInfo": "questionsErrorInfo",
  "questions.unknownError": "questionsUnknownError",
  "questions.status.pending": "statusPending",
  "questions.status.processing": "statusProcessing",
  "questions.status.completed": "statusCompleted",
  "questions.status.failed": "statusFailed",
  "messages.pleaseEnterQuestion": "msgPleaseEnterQuestion",
  "messages.questionsAdded": "msgQuestionsAdded",
  "messages.inputCleared": "msgInputCleared",
  "messages.alreadyRunning": "msgAlreadyRunning",
  "messages.noQuestions": "msgNoQuestions",
  "messages.executionPaused": "msgExecutionPaused",
  "messages.executionResumed": "msgExecutionResumed",
  "messages.executionStopped": "msgExecutionStopped",
  "messages.noFailedQuestions": "msgNoFailedQuestions",
  "messages.noResults": "msgNoResults",
  "messages.resultsExported": "msgResultsExported",
  "messages.pleaseStopFirst": "msgPleaseStopFirst",
  "messages.confirmClearAll": "msgConfirmClearAll",
  "messages.allCleared": "msgAllCleared",
  "messages.completed": "msgCompleted",
  "messages.failed": "msgFailed",
  "messages.waitingNext": "msgWaitingNext",
  "messages.allCompleted": "msgAllCompleted",
  "messages.openingChatGPT": "msgOpeningChatGPT",
  "messages.cannotOpenChatGPT": "msgCannotOpenChatGPT",
  "messages.error": "msgError",
  "messages.startingBatch": "msgStartingBatch",
  "messages.foundPending": "msgFoundPending",
  "messages.waitingPage": "msgWaitingPage",
  "messages.startingFirst": "msgStartingFirst",
  "messages.resetFailed": "msgResetFailed",
  "messages.submittedWaiting": "msgSubmittedWaiting",
  "messages.processingFailed": "msgProcessingFailed",
  "messages.loadedQuestions": "msgLoadedQuestions",
  "messages.loadFailed": "msgLoadFailed",
  "messages.ready": "msgReady"
};

let questions = [];
let isRunning = false;
let isPaused = false;
let currentIndex = 0;
let lastProcessedMessageTimestamp = 0;

const questionsInput = document.getElementById("questionsInput");
const addQuestionsBtn = document.getElementById("addQuestionsBtn");
const clearInputBtn = document.getElementById("clearInputBtn");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const stopBtn = document.getElementById("stopBtn");
const stopBtn2 = document.getElementById("stopBtn2");
const retryFailedBtn = document.getElementById("retryFailedBtn");
const exportBtn = document.getElementById("exportBtn");
const useTempChatCheckbox = document.getElementById("useTempChatCheckbox");
const useWebSearchCheckbox = document.getElementById("useWebSearchCheckbox");
const clearAllBtn = document.getElementById("clearAllBtn");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const idleButtons = document.getElementById("idleButtons");
const runningButtons = document.getElementById("runningButtons");
const pausedButtons = document.getElementById("pausedButtons");
const retryButtonContainer = document.getElementById("retryButtonContainer");
const questionsList = document.getElementById("questionsList");
const logContainer = document.getElementById("logContainer");
const totalCount = document.getElementById("totalCount");
const completedCount = document.getElementById("completedCount");
const successCount = document.getElementById("successCount");
const failedCount = document.getElementById("failedCount");
const progressFill = document.getElementById("progressFill");

function t(key, substitutions) {
  const messageName = KEY_MAP[key] || key;
  let translated;

  if (substitutions) {
    if (typeof substitutions !== "object" || Array.isArray(substitutions)) {
      const values = Array.isArray(substitutions)
        ? substitutions.map(String)
        : String(substitutions);
      translated = chrome.i18n.getMessage(messageName, values);
    } else {
      translated = chrome.i18n.getMessage(
        messageName,
        Object.values(substitutions).map(String)
      );
    }
  } else {
    translated = chrome.i18n.getMessage(messageName);
  }

  if (!translated) {
    return key;
  }

  if (substitutions && typeof substitutions === "object" && !Array.isArray(substitutions)) {
    return translated.replace(/\{(\w+)\}/g, (match, token) => {
      return substitutions[token] !== undefined ? substitutions[token] : match;
    });
  }

  return translated;
}

function setupEventListeners() {
  addQuestionsBtn.addEventListener("click", handleAddQuestions);
  clearInputBtn.addEventListener("click", handleClearInput);
  startBtn.addEventListener("click", handleStart);
  pauseBtn.addEventListener("click", handlePause);
  resumeBtn.addEventListener("click", handleResume);
  stopBtn.addEventListener("click", handleStop);
  stopBtn2.addEventListener("click", handleStop);
  retryFailedBtn.addEventListener("click", handleRetryFailed);
  useTempChatCheckbox.addEventListener("change", handleTempChatChange);
  useWebSearchCheckbox.addEventListener("change", handleWebSearchChange);
  exportBtn.addEventListener("click", handleExport);
  clearAllBtn.addEventListener("click", handleClearAll);
}

function applyTranslations() {
  document.title = t("title");
  document.documentElement.lang = BROWSER_LANG;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.getAttribute("data-i18n"));
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.getAttribute("data-i18n-placeholder"));
  });

  updateUI();
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function handleAddQuestions() {
  const rawValue = questionsInput.value.trim();
  if (!rawValue) {
    addLog(t("messages.pleaseEnterQuestion"), "warning");
    return;
  }

  let addedCount = 0;
  rawValue
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((question) => {
      questions.push({
        id: generateUUID(),
        question,
        status: "pending",
        answer: "",
        sources: [],
        timestamp: Date.now(),
        error: null
      });
      addedCount += 1;
    });

  if (!addedCount) {
    return;
  }

  questionsInput.value = "";
  saveQuestions();
  updateUI();
  addLog(`${addedCount} ${t("messages.questionsAdded")}`, "success");
}

function handleClearInput() {
  questionsInput.value = "";
  addLog(t("messages.inputCleared"), "info");
}

async function handleStart() {
  if (isRunning) {
    addLog(t("messages.alreadyRunning"), "warning");
    return;
  }

  if (questions.length === 0) {
    addLog(t("messages.noQuestions"), "warning");
    return;
  }

  const pendingQuestions = questions.filter(
    (question) => question.status === "pending" || question.status === "failed"
  );
  if (pendingQuestions.length === 0) {
    addLog(t("messages.noQuestions"), "warning");
    return;
  }

  questions.forEach((question) => {
    if (question.status === "failed") {
      question.status = "pending";
      question.error = null;
    }
  });

  saveQuestions();
  updateUI();
  addLog(t("messages.openingChatGPT"), "info");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_CHATGPT",
      useTempChat: useTempChatCheckbox.checked,
      useWebSearch: useWebSearchCheckbox.checked
    });

    if (!response?.success) {
      addLog(
        `${t("messages.cannotOpenChatGPT")}: ${response?.error || "Unknown error"}`,
        "error"
      );
      return;
    }
  } catch (error) {
    addLog(`${t("messages.error")}: ${error.message}`, "error");
    return;
  }

  isRunning = true;
  isPaused = false;
  currentIndex = 0;
  updateControlButtons();

  addLog(t("messages.startingBatch"), "info");
  addLog(t("messages.foundPending", { count: pendingQuestions.length }), "info");
  addLog(t("messages.waitingPage"), "info");

  await sleep(3000);
  addLog(t("messages.startingFirst"), "info");
  processNextQuestion();
}

function handlePause() {
  isPaused = true;
  updateControlButtons();
  addLog(t("messages.executionPaused"), "warning");
}

function handleResume() {
  isPaused = false;
  updateControlButtons();
  addLog(t("messages.executionResumed"), "info");
  processNextQuestion();
}

function handleStop() {
  isRunning = false;
  isPaused = false;
  updateControlButtons();
  addLog(t("messages.executionStopped"), "warning");
}

function handleRetryFailed() {
  if (isRunning) {
    addLog(t("messages.pleaseStopFirst"), "warning");
    return;
  }

  const failedQuestions = questions.filter((question) => question.status === "failed");
  if (failedQuestions.length === 0) {
    addLog(t("messages.noFailedQuestions"), "info");
    return;
  }

  failedQuestions.forEach((question) => {
    question.status = "pending";
    question.error = null;
  });

  saveQuestions();
  updateUI();
  addLog(t("messages.resetFailed", { count: failedQuestions.length }), "success");
}

async function processNextQuestion() {
  if (!isRunning || isPaused) {
    return;
  }

  let nextQuestion = null;
  for (let index = currentIndex; index < questions.length; index += 1) {
    if (questions[index].status === "pending") {
      nextQuestion = questions[index];
      currentIndex = index;
      break;
    }
  }

  if (!nextQuestion) {
    isRunning = false;
    updateControlButtons();
    addLog(t("messages.allCompleted"), "success");
    return;
  }

  nextQuestion.status = "processing";
  saveQuestions();
  updateUI();
  addLog(`[${currentIndex + 1}/${questions.length}]: ${nextQuestion.question.substring(0, 50)}...`, "info");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "PROCESS_QUESTION",
      question: nextQuestion.question,
      questionId: nextQuestion.id,
      useTempChat: useTempChatCheckbox.checked,
      useWebSearch: useWebSearchCheckbox.checked
    });

    if (!response?.success) {
      throw new Error(response?.error || "No response from background script");
    }

    addLog(t("messages.submittedWaiting"), "info");
  } catch (error) {
    nextQuestion.status = "failed";
    nextQuestion.error = error.message;
    saveQuestions();
    updateUI();
    addLog(`${t("messages.processingFailed")}: ${error.message}`, "error");
    currentIndex += 1;

    if (isRunning && !isPaused) {
      await sleep(2000);
      processNextQuestion();
    }
  }
}

function handleQuestionComplete(result) {
  const question = questions.find((entry) => entry.id === result.questionId);
  if (!question || question.status === "completed" || question.status === "failed") {
    return;
  }

  if (result.success) {
    question.status = "completed";
    question.answer = result.answer;
    question.sources = result.sources || [];
    question.completedAt = Date.now();
    addLog(`${t("messages.completed")}: ${question.question.substring(0, 50)}...`, "success");
  } else {
    question.status = "failed";
    question.error = result.error;
    question.completedAt = Date.now();
    addLog(`${t("messages.failed")}: ${question.question.substring(0, 50)}... - ${result.error}`, "error");
  }

  saveQuestions();
  updateUI();
  currentIndex += 1;

  if (isRunning && !isPaused) {
    addLog(t("messages.waitingNext"), "info");
    sleep(3000).then(() => {
      processNextQuestion();
    });
  }
}

function handleExport() {
  if (questions.length === 0) {
    addLog(t("messages.noResults"), "warning");
    return;
  }

  const exportPayload = {
    exportTime: new Date().toISOString(),
    totalQuestions: questions.length,
    completedQuestions: questions.filter((question) => question.status === "completed").length,
    questions: questions.map((question) => ({
      question: question.question,
      status: question.status,
      answer: question.answer,
      sources: question.sources,
      timestamp: question.timestamp,
      completedAt: question.completedAt,
      error: question.error
    }))
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = `chatgpt-answers-${Date.now()}.json`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
  addLog(t("messages.resultsExported"), "success");
}

function handleClearAll() {
  if (isRunning) {
    addLog(t("messages.pleaseStopFirst"), "warning");
    return;
  }

  if (!window.confirm(t("messages.confirmClearAll"))) {
    return;
  }

  questions = [];
  saveQuestions();
  updateUI();
  addLog(t("messages.allCleared"), "info");
}

function updateUI() {
  updateStatistics();
  updateQuestionsList();
  updateControlButtons();
}

function updateStatValue(element, value) {
  const previousValue = parseInt(element.textContent, 10) || 0;
  element.textContent = value;

  if (value > previousValue) {
    element.classList.remove("updated");
    element.offsetWidth;
    element.classList.add("updated");
    setTimeout(() => {
      element.classList.remove("updated");
    }, 400);
  }
}

function updateStatistics() {
  const total = questions.length;
  const completed = questions.filter(
    (question) => question.status === "completed" || question.status === "failed"
  ).length;
  const success = questions.filter((question) => question.status === "completed").length;
  const failed = questions.filter((question) => question.status === "failed").length;
  const processing = questions.filter((question) => question.status === "processing").length;

  updateStatValue(totalCount, total);
  updateStatValue(completedCount, completed);
  updateStatValue(successCount, success);
  updateStatValue(failedCount, failed);

  const progress = total > 0 ? (completed / total) * 100 : 0;
  progressFill.style.width = `${progress}%`;
  progressPercent.textContent = `${Math.round(progress)}%`;

  if (isRunning && processing > 0) {
    const processingIndex = questions.findIndex((question) => question.status === "processing");
    if (processingIndex !== -1) {
      progressText.textContent = t("progress.processing", {
        current: processingIndex + 1,
        total
      });
    } else {
      progressText.textContent = t("progress.running");
    }
  } else if (isPaused) {
    progressText.textContent = t("progress.paused");
  } else if (total > 0 && completed === total) {
    progressText.textContent = t("progress.completed");
  } else {
    progressText.textContent = t("progress.ready");
  }

  const failedCard = document.querySelector(".stat-failed");
  if (failedCard) {
    failedCard.classList.toggle("stat-muted", failed === 0);
  }
}

function updateQuestionsList() {
  if (questions.length === 0) {
    questionsList.innerHTML = `
      <div class="empty-state">
        <p data-i18n="questions.noQuestions">${t("questions.noQuestions")}</p>
        <p data-i18n="questions.addToStart">${t("questions.addToStart")}</p>
      </div>
    `;
    return;
  }

  questionsList.innerHTML = "";
  [...questions].reverse().forEach((question) => {
    questionsList.appendChild(createQuestionItem(question));
  });
}

function createQuestionItem(question) {
  const item = document.createElement("div");
  item.className = "question-item";
  item.dataset.id = question.id;

  const statusLabel = t(`questions.status.${question.status}`);
  let details = "";

  if (question.status === "completed") {
    const sourcesMarkup = question.sources.length
      ? `
        <div class="detail-section">
          <h4>${t("questions.sources")} (${question.sources.length})</h4>
          <ul class="sources-list">
            ${question.sources
              .map(
                (source) => `
                  <li class="source-item">
                    <div class="source-title">${escapeHtml(source.title)}</div>
                    <a href="${escapeHtml(source.url)}" target="_blank" class="source-url">${escapeHtml(source.url)}</a>
                    ${source.snippet ? `<div class="source-snippet">${escapeHtml(source.snippet)}</div>` : ""}
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      `
      : "";

    details = `
      <div class="question-details">
        <div class="detail-section">
          <h4>${t("questions.question")}</h4>
          <div class="answer-text">${escapeHtml(question.question)}</div>
        </div>
        <div class="detail-section">
          <h4>${t("questions.answer")}</h4>
          <div class="answer-text">${escapeHtml(question.answer || t("questions.noAnswer"))}</div>
        </div>
        ${sourcesMarkup}
      </div>
    `;
  } else if (question.status === "failed") {
    details = `
      <div class="question-details">
        <div class="detail-section">
          <h4>${t("questions.question")}</h4>
          <div class="answer-text">${escapeHtml(question.question)}</div>
        </div>
        <div class="detail-section">
          <h4>${t("questions.errorInfo")}</h4>
          <div class="error-text">${escapeHtml(question.error || t("questions.unknownError"))}</div>
        </div>
      </div>
    `;
  }

  const completedTime = question.completedAt
    ? new Date(question.completedAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "";

  item.innerHTML = `
    <div class="question-header">
      <span class="status-badge ${question.status}">${statusLabel}</span>
      <div class="question-text" title="${escapeHtml(question.question)}">${escapeHtml(question.question)}</div>
      ${completedTime ? `<span class="question-time">${completedTime}</span>` : ""}
    </div>
    ${details}
  `;

  item.addEventListener("click", () => {
    item.classList.toggle("expanded");
  });

  return item;
}

function updateControlButtons() {
  idleButtons.style.display = "none";
  runningButtons.style.display = "none";
  pausedButtons.style.display = "none";

  if (isRunning) {
    if (isPaused) {
      pausedButtons.style.display = "flex";
    } else {
      runningButtons.style.display = "flex";
    }
  } else {
    idleButtons.style.display = "flex";
  }

  retryButtonContainer.style.display =
    questions.some((question) => question.status === "failed") && !isRunning ? "flex" : "none";
}

function addLog(message, level = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function saveQuestions() {
  chrome.storage.local.set({ questions });
}

function saveTempChatSetting(enabled) {
  chrome.storage.local.set({ useTempChat: enabled });
}

function handleTempChatChange(event) {
  const enabled = event.target.checked;
  saveTempChatSetting(enabled);
  addLog(t(enabled ? "msgTempChatEnabled" : "msgTempChatDisabled"), "info");
}

async function loadQuestions() {
  try {
    const stored = await chrome.storage.local.get(["questions"]);
    if (!stored.questions) {
      return;
    }

    questions = stored.questions;
    updateUI();
    addLog(t("messages.loadedQuestions", { count: questions.length }), "info");
  } catch (error) {
    addLog(`${t("messages.loadFailed")}: ${error.message}`, "error");
  }
}

async function loadTempChatSetting() {
  try {
    const stored = await chrome.storage.local.get(["useTempChat"]);
    useTempChatCheckbox.checked = stored.useTempChat === undefined ? true : stored.useTempChat;
  } catch {
    useTempChatCheckbox.checked = true;
  }
}

function saveWebSearchSetting(enabled) {
  chrome.storage.local.set({ useWebSearch: enabled });
}

function handleWebSearchChange(event) {
  const enabled = event.target.checked;
  saveWebSearchSetting(enabled);
  addLog(t(enabled ? "msgWebSearchEnabled" : "msgWebSearchDisabled"), "info");
}

async function loadWebSearchSetting() {
  try {
    const stored = await chrome.storage.local.get(["useWebSearch"]);
    useWebSearchCheckbox.checked = stored.useWebSearch === undefined ? true : stored.useWebSearch;
  } catch {
    useWebSearchCheckbox.checked = true;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  if (!value) {
    return "";
  }

  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  applyTranslations();
  setupEventListeners();
  await loadQuestions();
  await loadTempChatSetting();
  await loadWebSearchSetting();
  updateUI();
  addLog(t("messages.ready"), "success");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "QUESTION_COMPLETE":
      handleQuestionComplete(message.result);
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

  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.pendingMessage) {
    return;
  }

  const pendingMessage = changes.pendingMessage.newValue;
  if (!pendingMessage) {
    return;
  }

  if (pendingMessage.timestamp && pendingMessage.timestamp <= lastProcessedMessageTimestamp) {
    return;
  }

  if (pendingMessage.timestamp) {
    lastProcessedMessageTimestamp = pendingMessage.timestamp;
  }

  switch (pendingMessage.type) {
    case "QUESTION_COMPLETE":
      handleQuestionComplete(pendingMessage.result);
      chrome.storage.local.remove("pendingMessage");
      break;
    case "UPDATE_PROGRESS":
      chrome.storage.local.remove("pendingMessage");
      break;
    case "LOG_MESSAGE":
      addLog(pendingMessage.message, pendingMessage.level || "info");
      chrome.storage.local.remove("pendingMessage");
      break;
    default:
      break;
  }
});