(function registerSSEHandlerModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace } = SharedUtils;

  let sseChunks = [];
  let isParsing = false;

  function initSSEState() {
    sseChunks = [];
    isParsing = false;
  }

  function getSiteProfile() {
    return globalThis.CONFIG?.getSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {};
  }

  function getValueByPath(source, path) {
    if (!source || typeof path !== "string" || !path.trim()) {
      return undefined;
    }

    return path.split(".").reduce((current, segment) => {
      if (current === undefined || current === null) {
        return undefined;
      }

      return /^\d+$/.test(segment) ? current[Number(segment)] : current[segment];
    }, source);
  }

  function extractAnswerFromChunk(chunk) {
    const configuredPaths = getSiteProfile().capture?.jsonPaths || [];
    const candidates = [
      ...configuredPaths.map((path) => getValueByPath(chunk, path)),
      chunk?.candidates?.[0]?.content?.parts,
      chunk?.candidates?.[0]?.content,
      chunk?.candidates?.[0]?.output?.[0]?.content?.parts,
      chunk?.output?.[0]?.content?.parts,
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
          .map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }

            if (entry && typeof entry.text === "string") {
              return entry.text;
            }

            return "";
          })
          .filter(Boolean)
          .join("\n")
      );
    }

    if (typeof candidate === "object") {
      if (typeof candidate.text === "string") {
        return normalizeWhitespace(candidate.text);
      }

      if (Array.isArray(candidate.parts)) {
        return normalizeCandidateText(candidate.parts);
      }

      if (candidate.content) {
        return normalizeCandidateText(candidate.content);
      }
    }

    return "";
  }

  function handleSSEData(data, context) {
    if (!context.isProcessing || !context.currentQuestion) {
      return;
    }

    sseChunks.push(data);
    const partialAnswer = extractAnswerFromChunk(data);
    if (partialAnswer) {
      context.currentAnswer = partialAnswer;
    }
  }

  async function handleSSEDone(context) {
    if (isParsing || !context.isProcessing || !context.currentQuestion || sseChunks.length === 0) {
      return;
    }

    isParsing = true;

    try {
      const scraped = await modules.waitForAssistantAnswer();
      if (scraped.answer) {
        context.currentAnswer = scraped.answer;
        context.currentSources = scraped.sources;
        context.handleAnswerComplete();
        return;
      }

      if (context.currentAnswer) {
        context.handleAnswerComplete();
        return;
      }

      context.sendQuestionResult(false, "Unable to extract the assistant answer from the page");
    } catch (error) {
      if (context.currentAnswer) {
        context.handleAnswerComplete();
      } else {
        context.sendQuestionResult(false, `Answer extraction error: ${error.message}`);
      }
    } finally {
      isParsing = false;
    }
  }

  function handleSSEError(errorMessage, context) {
    if (context.isProcessing && context.currentQuestion) {
      context.sendQuestionResult(false, errorMessage);
    }
  }

  Object.assign(modules, {
    initSSEState,
    handleSSEData,
    handleSSEDone,
    handleSSEError
  });
})();