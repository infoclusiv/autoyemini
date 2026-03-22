let currentQuestion = null;
let currentAnswer = "";
let currentSources = [];
let isProcessing = false;
let isParsing = false;
let sseChunks = [];

function injectSSEInterceptor() {
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
  } catch {}
}

function handleSSEData(data) {
  if (!isProcessing || !currentQuestion) {
    return;
  }

  sseChunks.push(data);
  const partialAnswer = extractAnswerFromChunk(data);
  if (partialAnswer) {
    currentAnswer = partialAnswer;
  }
}

async function handleSSEDone() {
  if (isParsing || !isProcessing || !currentQuestion || sseChunks.length === 0) {
    return;
  }

  isParsing = true;

  try {
    const scraped = await waitForAssistantAnswer();
    if (scraped.answer) {
      currentAnswer = scraped.answer;
      currentSources = scraped.sources;
      handleAnswerComplete();
      return;
    }

    if (currentAnswer) {
      handleAnswerComplete();
      return;
    }

    sendQuestionResult(false, "Unable to extract the assistant answer from the page");
  } catch (error) {
    if (currentAnswer) {
      handleAnswerComplete();
    } else {
      sendQuestionResult(false, `Answer extraction error: ${error.message}`);
    }
  } finally {
    isParsing = false;
  }
}

async function handleStreamEnd() {}

function extractAnswerFromChunk(chunk) {
  const candidates = [
    chunk?.message?.content?.parts,
    chunk?.message?.content?.text,
    chunk?.message?.content?.content,
    chunk?.v,
    chunk?.text
  ];

  for (const candidate of candidates) {
    const text = normalizeCandidateText(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeCandidateText(candidate) {
  if (!candidate) {
    return "";
  }

  if (typeof candidate === "string") {
    return normalizeWhitespace(candidate);
  }

  if (Array.isArray(candidate)) {
    return normalizeWhitespace(
      candidate
        .map((entry) => (typeof entry === "string" ? entry : ""))
        .filter(Boolean)
        .join("\n")
    );
  }

  return "";
}

function handleSSEError(errorMessage) {
  if (isProcessing && currentQuestion) {
    sendQuestionResult(false, errorMessage);
  }
}

function handleAnswerComplete() {
  if (!isProcessing || !currentQuestion) {
    return;
  }

  sendQuestionResult(true);
}

function sendQuestionResult(success, error = null) {
  const result = {
    success,
    questionId: currentQuestion.questionId,
    question: currentQuestion.question,
    answer: currentAnswer,
    sources: currentSources,
    error
  };

  chrome.runtime.sendMessage({ type: "QUESTION_COMPLETE", result }, () => {
    chrome.runtime.lastError;
  });

  isProcessing = false;
  currentQuestion = null;
  currentAnswer = "";
  currentSources = [];
  sseChunks = [];
}

function clickElement(element) {
  if (!element) {
    return false;
  }

  try {
    element.scrollIntoView({ behavior: "instant", block: "center" });
  } catch {}

  try {
    element.click();
    return true;
  } catch {}

  try {
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    element.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    return true;
  } catch {}

  try {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    element.click();
    return true;
  } catch {}

  return false;
}

function findSearchMenuItem(menu) {
  const menuItems = Array.from(menu.querySelectorAll(".__menu-item"));
  const iconMatch = menuItems.find((item) => {
    const path = item.querySelector("svg path");
    const value = path?.getAttribute("d");
    return value && (value.startsWith("M10 2.125C14.3492") || value.includes("17.875 10C17.875 14.3492"));
  });
  if (iconMatch) {
    return iconMatch;
  }

  const groups = menu.querySelectorAll('[role="group"]');
  if (groups.length >= 2) {
    const fallbackItems = Array.from(groups[1].querySelectorAll(".__menu-item")).filter((item) => {
      const hasSvg = item.querySelector("svg") !== null;
      const hasImage = item.querySelector("img") !== null;
      const text = item.textContent.trim();
      return hasSvg && !hasImage && text.length <= 10;
    });

    if (fallbackItems.length > 0) {
      return fallbackItems[fallbackItems.length - 1];
    }
  }

  return (
    menuItems.find((item) => {
      const text = item.textContent.trim();
      const lowered = text.toLowerCase();
      if (
        [
          "Search",
          "Web Search",
          "Suche",
          "Recherche",
          "Recherche Web",
          "Buscar",
          "Busqueda Web",
          "搜索",
          "搜尋",
          "网页搜索",
          "網頁搜尋",
          "検索",
          "ウェブ検索",
          "검색",
          "웹 검색",
          "Поиск",
          "Веб-поиск"
        ].includes(text)
      ) {
        return true;
      }

      if (text.length <= 10) {
        if (text.startsWith("搜索") && !text.includes("聊天") && !text.includes("对话")) {
          return true;
        }
        if (text.startsWith("搜尋") && !text.includes("聊天") && !text.includes("對話")) {
          return true;
        }
        if (lowered.startsWith("search") && !lowered.includes("chat") && !lowered.includes("conversation")) {
          return true;
        }
      }

      return false;
    }) || null
  );
}

async function enableWebSearchViaSlash() {
  try {
    const input = document.querySelector('div[contenteditable="true"]#prompt-textarea, textarea#prompt-textarea');
    if (!input) {
      return false;
    }

    input.focus();
    await sleep(500);
    input.innerHTML = "";
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        code: "Slash",
        keyCode: 191,
        which: 191,
        bubbles: true,
        cancelable: true
      })
    );
    input.innerHTML = "/";

    const range = document.createRange();
    const selection = window.getSelection();
    if (input.childNodes.length > 0) {
      range.setStart(input.childNodes[0], 1);
      range.collapse(true);
    } else {
      range.selectNodeContents(input);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);

    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "/"
      })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "/",
        code: "Slash",
        keyCode: 191,
        which: 191,
        bubbles: true,
        cancelable: true
      })
    );

    await sleep(2000);

    const overlays = document.querySelectorAll('div[style*="position: absolute"], div[style*="position: fixed"]');
    let menu = null;

    for (const overlay of overlays) {
      const items = overlay.querySelectorAll(".__menu-item");
      if (items.length > 0 && items.length < 20) {
        const hasSearchIcon = Array.from(overlay.querySelectorAll("svg path")).some((path) => {
          const value = path.getAttribute("d");
          return value && (value.startsWith("M10 2.125C14.3492") || value.includes("17.875 10C17.875 14.3492"));
        });
        if (hasSearchIcon) {
          menu = overlay;
          break;
        }
      }
    }

    if (!menu) {
      for (const overlay of overlays) {
        const items = overlay.querySelectorAll(".__menu-item");
        const groups = overlay.querySelectorAll('[role="group"]');
        if (items.length >= 3 && items.length <= 15 && groups.length >= 1 && groups.length <= 4) {
          menu = overlay;
          break;
        }
      }
    }

    if (!menu) {
      input.innerHTML = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return false;
    }

    const menuItem = findSearchMenuItem(menu);
    if (!menuItem) {
      input.innerHTML = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return false;
    }

    await clickWithEvents(menuItem);
    await sleep(1000);
    input.innerHTML = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

async function enableWebSearch() {
  try {
    const selectedButtons = document.querySelectorAll('button[data-is-selected="true"]');
    for (const button of selectedButtons) {
      const label = button.textContent || "";
      if (label.includes("搜索") || label.toLowerCase().includes("search")) {
        return true;
      }
    }

    return enableWebSearchViaSlash();
  } catch {
    return false;
  }
}

async function clickWithEvents(element) {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  element.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window, clientX, clientY })
  );
  await sleep(50);
  element.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0
    })
  );
  await sleep(50);
  element.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0
    })
  );
  await sleep(50);
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0
    })
  );
  element.click();
}

async function inputQuestion(question) {
  try {
    let input = document.querySelector('div[contenteditable="true"]#prompt-textarea');
    if (!input) {
      input = document.querySelector("textarea#prompt-textarea, textarea[placeholder]");
    }
    if (!input) {
      throw new Error("Input element not found");
    }

    input.focus();
    await sleep(300);

    if (input.hasAttribute("contenteditable")) {
      input.innerHTML = "";
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createTextNode(question));
      input.appendChild(paragraph);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: question
        })
      );
    } else {
      input.value = question;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await sleep(500);
    return true;
  } catch {
    return false;
  }
}

async function submitQuestion() {
  try {
    await sleep(500);

    const contentEditable = document.querySelector('div[contenteditable="true"]#prompt-textarea');
    if (contentEditable) {
      contentEditable.focus();
      await sleep(200);
      contentEditable.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
      contentEditable.dispatchEvent(
        new KeyboardEvent("keypress", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
      await sleep(1000);
      return true;
    }

    let sendButton = document.querySelector("button#composer-submit-button");
    if (!sendButton) {
      sendButton = document.querySelector('button[data-testid="send-button"]');
    }
    if (!sendButton) {
      sendButton = document.querySelector('button[aria-label*="发送"], button[aria-label*="Send"]');
    }
    if (!sendButton) {
      return true;
    }

    if (sendButton.disabled) {
      for (let attempt = 0; attempt < 10 && sendButton.disabled; attempt += 1) {
        await sleep(500);
      }
    }

    if (!sendButton.disabled) {
      clickElement(sendButton);
    }

    await sleep(1000);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askQuestion(question, questionId, useTempChat = true, useWebSearch = true) {
  currentQuestion = { question, questionId };
  currentAnswer = "";
  currentSources = [];
  sseChunks = [];
  isProcessing = true;
  isParsing = false;

  try {
    if (useWebSearch) {
      await enableWebSearch();
    }

    if (!(await inputQuestion(question))) {
      throw new Error("Failed to input question");
    }

    if (!(await submitQuestion())) {
      throw new Error("Failed to submit question");
    }

    setTimeout(async () => {
      if (!isProcessing || !currentQuestion || currentQuestion.questionId !== questionId) {
        return;
      }

      const scraped = await waitForAssistantAnswer(6, 1500).catch(() => ({ answer: "", sources: [] }));
      if (scraped.answer) {
        currentAnswer = scraped.answer;
        currentSources = scraped.sources;
        handleAnswerComplete();
        return;
      }

      if (currentAnswer) {
        handleAnswerComplete();
        return;
      }

      sendQuestionResult(false, "Timeout waiting for answer");
    }, 120000);

    return { success: true, message: "Question submitted, waiting for answer" };
  } catch (error) {
    sendQuestionResult(false, error.message);
    return { success: false, error: error.message };
  }
}

function normalizeWhitespace(value) {
  return (value || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function getAssistantMessageElements() {
  const explicitAssistantNodes = Array.from(
    document.querySelectorAll('div[data-message-author-role="assistant"]')
  );
  if (explicitAssistantNodes.length > 0) {
    return explicitAssistantNodes;
  }

  return Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"]')).filter(
    (article) =>
      article.querySelector('.markdown, [class*="markdown"], .prose') ||
      article.querySelector('a[href^="http"]') ||
      article.innerText.trim().length > 0
  );
}

function getBestAnswerRoot(container) {
  return (
    container.querySelector('.markdown, [class*="markdown"], .prose') ||
    container.querySelector('[data-message-author-role="assistant"]') ||
    container
  );
}

function cloneForTextExtraction(node) {
  const clone = node.cloneNode(true);
  clone
    .querySelectorAll('button, nav, form, svg, script, style, textarea, [aria-hidden="true"]')
    .forEach((element) => element.remove());
  return clone;
}

function extractSources(container) {
  const seen = new Set();
  const sources = [];

  container.querySelectorAll('a[href^="http"]').forEach((link) => {
    const url = link.href;
    if (!url || seen.has(url)) {
      return;
    }

    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("chatgpt.com") || parsed.hostname.includes("openai.com")) {
        return;
      }
    } catch {
      return;
    }

    seen.add(url);
    sources.push({
      title: normalizeWhitespace(link.textContent) || url,
      url,
      snippet: ""
    });
  });

  return sources;
}

function scrapeLatestAssistantMessage() {
  const messages = getAssistantMessageElements();
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return { answer: "", sources: [] };
  }

  const answerRoot = getBestAnswerRoot(latestMessage);
  const clone = cloneForTextExtraction(answerRoot);
  return {
    answer: normalizeWhitespace(clone.innerText || clone.textContent || ""),
    sources: extractSources(answerRoot)
  };
}

async function waitForAssistantAnswer(maxAttempts = 12, delayMs = 1000) {
  let bestResult = { answer: "", sources: [] };
  let previousAnswer = "";
  let stableReads = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = scrapeLatestAssistantMessage();
    if (result.answer) {
      bestResult = result;

      if (result.answer === previousAnswer) {
        stableReads += 1;
      } else {
        previousAnswer = result.answer;
        stableReads = 0;
      }

      if (stableReads >= 1) {
        return result;
      }
    }

    await sleep(delayMs);
  }

  return bestResult;
}

function initializeContentScript() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectSSEInterceptor();
    });
  } else {
    injectSSEInterceptor();
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const { type, data, error } = event.data;
  switch (type) {
    case "SSE_DATA":
      handleSSEData(data);
      break;
    case "SSE_DONE":
      handleSSEDone();
      break;
    case "SSE_STREAM_END":
      handleStreamEnd();
      break;
    case "SSE_ERROR":
      handleSSEError(error);
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
    const useTempChat = message.useTempChat === undefined || message.useTempChat;
    const useWebSearch = message.useWebSearch === undefined || message.useWebSearch;

    askQuestion(message.question, message.questionId, useTempChat, useWebSearch)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

initializeContentScript();