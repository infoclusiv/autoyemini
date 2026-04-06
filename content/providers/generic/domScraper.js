(function registerGenericScraperModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace, sleep } = SharedUtils;

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
        const text = normalizeWhitespace(last.innerText || last.textContent || "");
        if (text.length > 10) {
          return { answer: text, sources: [] };
        }
      } catch {
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