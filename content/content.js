(function contentEntryPoint() {
  const modules = globalThis.ContentModules || {};

  const ContentState = {
    currentQuestion: null,
    currentAnswer: "",
    currentSources: [],
    isProcessing: false,
    providerConfig: null,
    sendQuestionResult,
    handleAnswerComplete
  };

  function injectSSEInterceptor() {
    const supportsSSE = ContentState.providerConfig?.supportsSSE
      ?? window.location.hostname.includes("chatgpt.com");

    if (!supportsSSE) {
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
    } catch {
    }
  }

  function resetState() {
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
    ContentState.currentQuestion = { question, questionId };
    ContentState.currentAnswer = "";
    ContentState.currentSources = [];
    ContentState.isProcessing = true;
    if (typeof modules.initSSEState === "function") {
      modules.initSSEState();
    }

    try {
      const supportsWebSearch = ContentState.providerConfig?.supportsWebSearch
        ?? window.location.hostname.includes("chatgpt.com");

      if (useWebSearch && supportsWebSearch && typeof modules.enableWebSearch === "function") {
        await modules.enableWebSearch(antiBotConfig || {});
      }

      if (!(await modules.inputQuestion(question, antiBotConfig || {}))) {
        throw new Error("Failed to input question");
      }

      if (!(await modules.submitQuestion(antiBotConfig || {}))) {
        throw new Error("Failed to submit question");
      }

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

    const supportsSSE = ContentState.providerConfig?.supportsSSE
      ?? window.location.hostname.includes("chatgpt.com");
    if (!supportsSSE) {
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

      if (message.providerConfig) {
        ContentState.providerConfig = message.providerConfig;
        window.__PROVIDER_CONFIG__ = message.providerConfig;
      }

      askQuestion(message.question, message.questionId, useTempChat, useWebSearch, antiBotConfig)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });

  initializeContentScript();
})();