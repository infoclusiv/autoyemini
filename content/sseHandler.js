(function registerSSEHandlerModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { normalizeWhitespace } = SharedUtils;

  let sseChunks = [];
  let isParsing = false;

  function initSSEState() {
    sseChunks = [];
    isParsing = false;
  }

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