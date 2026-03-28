(function registerDomScraperModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace, sleep } = SharedUtils;

  function getAssistantMessageElements() {
    const explicitAssistantNodes = Array.from(
      document.querySelectorAll('div[data-message-author-role="assistant"]')
    );
    if (explicitAssistantNodes.length > 0) {
      return explicitAssistantNodes;
    }

    return Array.from(
      document.querySelectorAll('article[data-testid^="conversation-turn-"]')
    ).filter(
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

  async function waitForAssistantAnswer(
    maxAttempts = CONFIG.TIMING.ANSWER_POLL_ATTEMPTS,
    delayMs = CONFIG.TIMING.ANSWER_POLL_INTERVAL_MS
  ) {
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

  Object.assign(modules, {
    waitForAssistantAnswer
  });
})();