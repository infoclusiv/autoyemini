const AppConfig = globalThis.CONFIG;

export function normalizeExtractionSettings(settings) {
  return {
    useExtraction: settings.useExtraction === true,
    extractionRegex:
      settings.extractionRegex || AppConfig.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>",
    injectionPlaceholder:
      settings.injectionPlaceholder ||
      AppConfig.EXTRACTION?.DEFAULT_PLACEHOLDER ||
      "{{extract}}"
  };
}

export function getExtractionExpression(pattern) {
  const normalizedPattern =
    pattern?.trim() || AppConfig.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
  const regexLiteralMatch = normalizedPattern.match(/^\/([\\s\\S]*)\/([a-z]*)$/i);

  if (regexLiteralMatch) {
    const [, source, flags] = regexLiteralMatch;
    const finalFlags = flags.includes("s") ? flags : `${flags}s`;
    return new RegExp(source, finalFlags);
  }

  return new RegExp(normalizedPattern, "s");
}

export function extractTextFromAnswer(answer, pattern) {
  const match = getExtractionExpression(pattern).exec(answer || "");
  if (!match) {
    return "";
  }

  return String(match[1] ?? match[0] ?? "").trim();
}

export function buildQuestionForSubmission(questionText, settings, lastExtractedText) {
  const extractionSettings = normalizeExtractionSettings(settings);
  if (!extractionSettings.useExtraction || !lastExtractedText) {
    return { text: questionText, wasInjected: false };
  }

  if (!questionText.includes(extractionSettings.injectionPlaceholder)) {
    return { text: questionText, wasInjected: false };
  }

  const injectedText = questionText
    .split(extractionSettings.injectionPlaceholder)
    .join(lastExtractedText);
  return { text: injectedText, wasInjected: true };
}
