(function registerGenericScraperModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace, sleep } = SharedUtils;
  const FALLBACK_RESPONSE_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn-role="model"]',
    '[data-testid*="response"]',
    '.markdown',
    '[class*="markdown"]',
    '.prose',
    'main article',
    'main section',
    '[role="main"] article',
    '[role="main"] section'
  ];

  function getProviderSelectors() {
    return window.__PROVIDER_CONFIG__?.selectors || {};
  }

  function isGenerating() {
    const selectors = getProviderSelectors();

    const signals = [
      selectors.stopButton
        ? () => {
            const element = document.querySelector(selectors.stopButton);
            return !!(element && element.offsetParent !== null && !element.hidden);
          }
        : null,
      selectors.submitButton
        ? () => document.querySelector(selectors.submitButton)?.disabled === true
        : null,
      selectors.loadingIndicator
        ? () => {
            const element = document.querySelector(selectors.loadingIndicator);
            return !!(element && element.offsetParent !== null);
          }
        : null
    ].filter(Boolean);

    return signals.some((signal) => {
      try {
        return signal();
      } catch {
        return false;
      }
    });
  }

  function cloneForTextExtraction(node) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('button, nav, form, svg, script, style, textarea, [aria-hidden="true"]')
      .forEach((element) => element.remove());
    return clone;
  }

  function getNodeText(node) {
    const clone = cloneForTextExtraction(node);
    return normalizeWhitespace(clone.innerText || clone.textContent || "");
  }

  function extractSources(container) {
    const seen = new Set();
    const sources = [];

    container.querySelectorAll('a[href^="http"]').forEach((link) => {
      const url = link.href;
      if (!url || seen.has(url)) {
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

  function getFallbackResponseNodes() {
    const nodes = [];
    const seen = new Set();

    FALLBACK_RESPONSE_SELECTORS.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node) || node === document.body || node === document.documentElement) {
            return;
          }

          if (node.offsetParent === null && node.getClientRects().length === 0) {
            return;
          }

          if (node.querySelector('textarea, [contenteditable="true"]')) {
            return;
          }

          seen.add(node);
          nodes.push(node);
        });
      } catch {
      }
    });

    return nodes;
  }

  function scrapeLatestAnswer() {
    const selectors = getProviderSelectors();
    const selectorList = [
      selectors.responseContainer,
      selectors.responseContainerFallback1,
      selectors.responseContainerFallback2
    ].filter(Boolean);

    for (const selector of selectorList) {
      try {
        const nodes = document.querySelectorAll(selector);
        if (!nodes.length) {
          continue;
        }

        const last = nodes[nodes.length - 1];
        const text = getNodeText(last);
        if (text.length > 10) {
          return { answer: text, sources: extractSources(last) };
        }
      } catch {
      }
    }

    const fallbackNodes = getFallbackResponseNodes();
    for (let index = fallbackNodes.length - 1; index >= 0; index -= 1) {
      const node = fallbackNodes[index];
      const answerRoot =
        node.querySelector('.markdown, [class*="markdown"], .prose') || node;
      const answer = getNodeText(answerRoot);

      if (answer.length > 20) {
        return {
          answer,
          sources: extractSources(answerRoot)
        };
      }
    }

    return { answer: "", sources: [] };
  }

  async function waitForAssistantAnswer(maxAttempts = 24, delayMs = 2500) {
    let previousAnswer = "";
    let stableReads = 0;
    let bestResult = { answer: "", sources: [] };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const generating = isGenerating();
      const result = scrapeLatestAnswer();

      if (result.answer) {
        bestResult = result;

        if (!generating) {
          if (result.answer === previousAnswer) {
            stableReads += 1;
            if (stableReads >= 2) {
              return result;
            }
          } else {
            previousAnswer = result.answer;
            stableReads = 0;
          }
        } else {
          previousAnswer = result.answer;
          stableReads = 0;
        }
      }

      await sleep(delayMs);
    }

    return bestResult;
  }

  function initSSEState() {}

  Object.assign(modules, { waitForAssistantAnswer, initSSEState });
})();