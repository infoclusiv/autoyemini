(function contentEntryPoint() {
  const modules = globalThis.ContentModules || {};

  function getCurrentSiteProfile() {
    return globalThis.CONFIG?.getSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {};
  }

  function syncSiteProfileToPage(siteProfile = getCurrentSiteProfile()) {
    if (document.documentElement) {
      document.documentElement.dataset.autoyeminiSiteProfile = JSON.stringify(siteProfile || {});
    }
  }

  async function refreshSiteProfile() {
    const siteProfile = await globalThis.CONFIG?.loadSiteProfile?.();
    syncSiteProfileToPage(siteProfile || getCurrentSiteProfile());
    return siteProfile || getCurrentSiteProfile();
  }

  const ContentState = {
    currentQuestion: null,
    currentAnswer: "",
    currentSources: [],
    isProcessing: false,
    sendQuestionResult,
    handleAnswerComplete
  };

  async function injectSSEInterceptor() {
    try {
      await refreshSiteProfile();
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected.js");
      script.onload = function onLoad() {
        this.remove();
      };
      script.onerror = function onError() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch {
    }
  }

  function resetState() {
    ContentState.currentQuestion = null;
    ContentState.currentAnswer = "";
    ContentState.currentSources = [];
    ContentState.isProcessing = false;
    modules.initSSEState();
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

  async function monitorAnswerViaDom(questionId, siteProfile) {
    const captureConfig = siteProfile?.capture || {};
    const initialDelay = captureConfig.mode === "stream_plus_dom"
      ? captureConfig.sseReadyDelayMs || CONFIG.TIMING.SSE_READY_WAIT_MS
      : 0;

    if (initialDelay > 0) {
      await SharedUtils.sleep(initialDelay);
    }

    const scraped = await modules
      .waitForAssistantAnswer(captureConfig.domMaxAttempts, captureConfig.domPollIntervalMs)
      .catch(() => ({ answer: "", sources: [] }));

    if (!ContentState.isProcessing || ContentState.currentQuestion?.questionId !== questionId) {
      return;
    }

    if (!scraped.answer) {
      return;
    }

    ContentState.currentAnswer = scraped.answer;
    ContentState.currentSources = scraped.sources;
    handleAnswerComplete();
  }

  async function askQuestion(
    question,
    questionId,
    useTempChat = true,
    useWebSearch = true,
    antiBotConfig = null
  ) {
    const siteProfile = await refreshSiteProfile();

    ContentState.currentQuestion = { question, questionId };
    ContentState.currentAnswer = "";
    ContentState.currentSources = [];
    ContentState.isProcessing = true;
    modules.initSSEState();

    try {
      if (useWebSearch) {
        await modules.enableWebSearch(antiBotConfig || {});
      }

      if (!(await modules.inputQuestion(question, antiBotConfig || {}))) {
        throw new Error("Failed to input question");
      }

      if (!(await modules.submitQuestion(antiBotConfig || {}))) {
        throw new Error("Failed to submit question");
      }

      void monitorAnswerViaDom(questionId, siteProfile);

      setTimeout(async () => {
        if (!ContentState.isProcessing || ContentState.currentQuestion?.questionId !== questionId) {
          return;
        }

        const scraped = await modules
          .waitForAssistantAnswer(6, 1500)
          .catch(() => ({ answer: "", sources: [] }));

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
      }, CONFIG.TIMING.ANSWER_TIMEOUT_MS);

      return { success: true, message: "Question submitted, waiting for answer" };
    } catch (error) {
      sendQuestionResult(false, error.message);
      return { success: false, error: error.message };
    }
  }

  function initializeContentScript() {
    void refreshSiteProfile();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void injectSSEInterceptor();
      });
    } else {
      void injectSSEInterceptor();
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const { type, data, error } = event.data;
    switch (type) {
      case "SSE_DATA":
        modules.handleSSEData(data, ContentState);
        break;
      case "SSE_DONE":
        modules.handleSSEDone(ContentState);
        break;
      case "SSE_ERROR":
        modules.handleSSEError(error, ContentState);
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

      askQuestion(message.question, message.questionId, useTempChat, useWebSearch, antiBotConfig)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  if (chrome.storage?.onChanged && !globalThis.__AUTOYEMINI_CONTENT_SITE_PROFILE_SYNC__) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, CONFIG.STORAGE_KEYS.SITE_PROFILE)) {
        syncSiteProfileToPage(getCurrentSiteProfile());
      }
    });

    globalThis.__AUTOYEMINI_CONTENT_SITE_PROFILE_SYNC__ = true;
  }

  initializeContentScript();
})();