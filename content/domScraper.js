(function registerDomScraperModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace, sleep } = SharedUtils;

  function getSiteProfile() {
    return globalThis.CONFIG?.getSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {};
  }

  function getSelectors() {
    return getSiteProfile().selectors || {};
  }

  function hasVisibleText(node) {
    return normalizeWhitespace(node?.innerText || node?.textContent || "").length > 0;
  }

  function getAssistantMessageElements() {
    const selectors = getSelectors();
    const explicitAssistantNodes = selectors.assistantMessage
      ? Array.from(document.querySelectorAll(selectors.assistantMessage)).filter(hasVisibleText)
      : [];
    if (explicitAssistantNodes.length > 0) {
      return explicitAssistantNodes;
    }

    const answerRoots = selectors.answerRoot
      ? Array.from(document.querySelectorAll(selectors.answerRoot)).filter(hasVisibleText)
      : [];
    if (answerRoots.length > 0) {
      return answerRoots;
    }

    return Array.from(document.querySelectorAll('[role="article"]')).filter(
      (article) =>
        article.querySelector(selectors.answerRoot || '.markdown, [class*="markdown"], .prose') ||
        article.querySelector('a[href^="http"]') ||
        article.innerText.trim().length > 0
    );
  }

  function getBestAnswerRoot(container) {
    const selectors = getSelectors();

    if (selectors.answerRoot && container.matches?.(selectors.answerRoot)) {
      return container;
    }

    return (
      container.querySelector(selectors.answerRoot || '.markdown, [class*="markdown"], .prose') ||
      container.querySelector(selectors.assistantMessage || '[role="article"]') ||
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
    const siteProfile = getSiteProfile();
    const sourceSelector = siteProfile.selectors?.sourceLinks || 'a[href^="http"]';
    const excludedHosts = Array.isArray(siteProfile.sourceExclusions)
      ? siteProfile.sourceExclusions
      : [];
    const seen = new Set();
    const sources = [];

    container.querySelectorAll(sourceSelector).forEach((link) => {
      const url = link.href;
      if (!url || seen.has(url)) {
        return;
      }

      try {
        const parsed = new URL(url);
        if (excludedHosts.some((hostname) => parsed.hostname.includes(hostname))) {
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
    maxAttempts = getSiteProfile().capture?.domMaxAttempts || CONFIG.TIMING.ANSWER_POLL_ATTEMPTS,
    delayMs = getSiteProfile().capture?.domPollIntervalMs || CONFIG.TIMING.ANSWER_POLL_INTERVAL_MS
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