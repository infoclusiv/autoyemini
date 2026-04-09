(function contentEntryPoint() {
  const modules = globalThis.ContentModules || {};

  function hostnamesMatch(hostname, providerHostname) {
    if (!hostname || !providerHostname) {
      return false;
    }

    const normalizedHostname = String(hostname).toLowerCase();
    const normalizedProviderHostname = String(providerHostname).toLowerCase();

    return (
      normalizedHostname === normalizedProviderHostname
      || normalizedHostname.endsWith(`.${normalizedProviderHostname}`)
      || normalizedHostname.includes(normalizedProviderHostname)
    );
  }

  function resolveProviderConfigForLocation() {
    return Object.values(CONFIG.PROVIDERS || {}).find((providerConfig) => {
      return providerConfig && hostnamesMatch(window.location.hostname, providerConfig.HOSTNAME);
    }) || null;
  }

  function getActiveProviderConfig() {
    return ContentState.providerConfig || resolveProviderConfigForLocation();
  }

  function updateProviderConfig(providerConfig = null) {
    ContentState.providerConfig = providerConfig || resolveProviderConfigForLocation();

    if (ContentState.providerConfig) {
      window.__PROVIDER_CONFIG__ = ContentState.providerConfig;
      return;
    }

    delete window.__PROVIDER_CONFIG__;
  }

  function supportsSSE(providerConfig = getActiveProviderConfig()) {
    return providerConfig?.supportsSSE === true;
  }

  function supportsWebSearch(providerConfig = getActiveProviderConfig()) {
    return providerConfig?.supportsWebSearch === true;
  }

  function supportsLivePolling(providerConfig = getActiveProviderConfig()) {
    return providerConfig?.supportsLivePolling === true;
  }

  function getAnswerTimeoutMs(providerConfig = getActiveProviderConfig()) {
    const timeoutMs = Number(providerConfig?.answerTimeoutMs);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : CONFIG.TIMING.ANSWER_TIMEOUT_MS;
  }

  function getAnswerPollingConfig(providerConfig = getActiveProviderConfig()) {
    const delayCandidate = Number(providerConfig?.answerPollIntervalMs);
    const delayMs = Number.isFinite(delayCandidate) && delayCandidate > 0
      ? delayCandidate
      : CONFIG.TIMING.ANSWER_POLL_INTERVAL_MS;
    const attemptsCandidate = Number(providerConfig?.answerPollAttempts);
    const maxAttempts = Number.isFinite(attemptsCandidate) && attemptsCandidate > 0
      ? attemptsCandidate
      : Math.max(CONFIG.TIMING.ANSWER_POLL_ATTEMPTS, Math.ceil(getAnswerTimeoutMs(providerConfig) / delayMs));

    return { maxAttempts, delayMs };
  }

  const ContentState = {
    currentQuestion: null,
    currentAnswer: "",
    currentSources: [],
    isProcessing: false,
    providerConfig: resolveProviderConfigForLocation(),
    answerTimeoutId: null,
    answerWatcherId: 0,
    sseInjected: false,
    sendQuestionResult,
    handleAnswerComplete
  };

  if (ContentState.providerConfig) {
    window.__PROVIDER_CONFIG__ = ContentState.providerConfig;
  }

  function injectSSEInterceptor() {
    const providerConfig = getActiveProviderConfig();

    if (!supportsSSE(providerConfig) || ContentState.sseInjected) {
      return;
    }

    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected.js");
      script.onload = function onLoad() {
        this.remove();
      };
      script.onerror = function onError() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      ContentState.sseInjected = true;
    } catch {
    }
  }

  function clearPendingAnswerTimeout() {
    if (ContentState.answerTimeoutId !== null) {
      clearTimeout(ContentState.answerTimeoutId);
      ContentState.answerTimeoutId = null;
    }
  }

  function beginAnswerWatchSession() {
    clearPendingAnswerTimeout();
    ContentState.answerWatcherId += 1;
    return ContentState.answerWatcherId;
  }

  function isCurrentWatch(questionId, watcherId) {
    return ContentState.isProcessing
      && ContentState.currentQuestion?.questionId === questionId
      && ContentState.answerWatcherId === watcherId;
  }

  async function scrapeLatestAnswer(maxAttempts, delayMs) {
    if (typeof modules.waitForAssistantAnswer !== "function") {
      return { answer: "", sources: [] };
    }

    return modules.waitForAssistantAnswer(maxAttempts, delayMs)
      .catch(() => ({ answer: "", sources: [] }));
  }

  async function startLivePolling(questionId, watcherId, providerConfig) {
    const { maxAttempts, delayMs } = getAnswerPollingConfig(providerConfig);
    const scraped = await scrapeLatestAnswer(maxAttempts, delayMs);

    if (!isCurrentWatch(questionId, watcherId) || !scraped.answer) {
      return;
    }

    clearPendingAnswerTimeout();
    ContentState.currentAnswer = scraped.answer;
    ContentState.currentSources = scraped.sources;
    handleAnswerComplete();
  }

  function resetState() {
    clearPendingAnswerTimeout();
    ContentState.answerWatcherId += 1;
    ContentState.currentQuestion = null;
    ContentState.currentAnswer = "";
    ContentState.currentSources = [];
    ContentState.isProcessing = false;
    if (typeof modules.initSSEState === "function") {
      modules.initSSEState();
    }
  }

  function sendQuestionResult(success, error = null) {
    const result = {
      success,
      questionId: ContentState.currentQuestion?.questionId,
      question: ContentState.currentQuestion?.question,
      answer: ContentState.currentAnswer,
      sources: ContentState.currentSources,
      error
    };

    chrome.runtime.sendMessage({ type: "QUESTION_COMPLETE", result }, () => {
      chrome.runtime.lastError;
    });

    resetState();
  }

  function handleAnswerComplete() {
    if (!ContentState.isProcessing || !ContentState.currentQuestion) {
      return;
    }

    sendQuestionResult(true);
  }

  async function askQuestion(
    question,
    questionId,
    useTempChat = true,
    useWebSearch = true,
    antiBotConfig = null
  ) {
    const providerConfig = getActiveProviderConfig();

    ContentState.currentQuestion = { question, questionId };
    ContentState.currentAnswer = "";
    ContentState.currentSources = [];
    ContentState.isProcessing = true;
    const watcherId = beginAnswerWatchSession();
    if (typeof modules.initSSEState === "function") {
      modules.initSSEState();
    }

    try {
      if (supportsSSE(providerConfig)) {
        injectSSEInterceptor();
      }

      if (useWebSearch && supportsWebSearch(providerConfig) && typeof modules.enableWebSearch === "function") {
        await modules.enableWebSearch(antiBotConfig || {});
      }

      if (!(await modules.inputQuestion(question, antiBotConfig || {}))) {
        throw new Error("Failed to input question");
      }

      if (!(await modules.submitQuestion(antiBotConfig || {}))) {
        throw new Error("Failed to submit question");
      }

      if (!supportsSSE(providerConfig) && supportsLivePolling(providerConfig)) {
        void startLivePolling(questionId, watcherId, providerConfig);
      }

      ContentState.answerTimeoutId = setTimeout(async () => {
        if (!isCurrentWatch(questionId, watcherId)) {
          return;
        }

        const scraped = await scrapeLatestAnswer(6, 1500);

        if (!isCurrentWatch(questionId, watcherId)) {
          return;
        }

        if (scraped.answer) {
          ContentState.currentAnswer = scraped.answer;
          ContentState.currentSources = scraped.sources;
          handleAnswerComplete();
          return;
        }

        if (ContentState.currentAnswer) {
          handleAnswerComplete();
          return;
        }

        sendQuestionResult(false, "Timeout waiting for answer");
      }, getAnswerTimeoutMs(providerConfig));

      return { success: true, message: "Question submitted, waiting for answer" };
    } catch (error) {
      sendQuestionResult(false, error.message);
      return { success: false, error: error.message };
    }
  }

  function initializeContentScript() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectSSEInterceptor);
    } else {
      injectSSEInterceptor();
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    if (!supportsSSE()) {
      return;
    }

    const { type, data, error } = event.data;
    switch (type) {
      case "SSE_DATA":
        modules.handleSSEData?.(data, ContentState);
        break;
      case "SSE_DONE":
        modules.handleSSEDone?.(ContentState);
        break;
      case "SSE_ERROR":
        modules.handleSSEError?.(error, ContentState);
        break;
      default:
        break;
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ ready: true });
      return true;
    }

    if (message.type === "ASK_QUESTION") {
      const useTempChat = message.useTempChat !== false;
      const useWebSearch = message.useWebSearch !== false;
      const antiBotConfig = message.antiBotConfig || {};

      updateProviderConfig(message.providerConfig);
      injectSSEInterceptor();

      askQuestion(message.question, message.questionId, useTempChat, useWebSearch, antiBotConfig)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  initializeContentScript();
})();