import { normalizeRange, normalizeNumber, normalizeString } from "./normalizers.js";

const antiBotDefaults = globalThis.CONFIG?.ANTI_BOT || {
  TYPING_SPEED_MS: [30, 100],
  FATIGUE_AFTER_QUESTIONS: 10,
  FATIGUE_PAUSE_MS: [20000, 40000]
};

const extractionDefaults = globalThis.CONFIG?.EXTRACTION || {
  DEFAULT_REGEX: "<extract>(.*?)</extract>",
  DEFAULT_PLACEHOLDER: "{{extract}}"
};

export function normalizeTemplateSettings(settings) {
  if (!settings || typeof settings !== "object") {
    return undefined;
  }

  const defaultTypingSpeed = normalizeRange(antiBotDefaults.TYPING_SPEED_MS, [30, 100]);
  const normalizedSettings = {};

  if ("useTempChat" in settings) {
    normalizedSettings.useTempChat = settings.useTempChat !== false;
  }
  if ("useWebSearch" in settings) {
    normalizedSettings.useWebSearch = settings.useWebSearch !== false;
  }
  if ("keepSameChat" in settings) {
    normalizedSettings.keepSameChat = settings.keepSameChat === true;
  }
  if ("useExtraction" in settings) {
    normalizedSettings.useExtraction = settings.useExtraction === true;
  }
  if ("extractionRegex" in settings) {
    normalizedSettings.extractionRegex = normalizeString(
      settings.extractionRegex,
      extractionDefaults.DEFAULT_REGEX
    );
  }
  if ("injectionPlaceholder" in settings) {
    normalizedSettings.injectionPlaceholder = normalizeString(
      settings.injectionPlaceholder,
      extractionDefaults.DEFAULT_PLACEHOLDER
    );
  }
  if ("humanTyping" in settings) {
    normalizedSettings.humanTyping = settings.humanTyping !== false;
  }
  if ("randomDelays" in settings) {
    normalizedSettings.randomDelays = settings.randomDelays !== false;
  }
  if ("biologicalPauses" in settings) {
    normalizedSettings.biologicalPauses = settings.biologicalPauses === true;
  }
  if ("typingSpeed" in settings) {
    normalizedSettings.typingSpeed = normalizeRange(settings.typingSpeed, defaultTypingSpeed);
  }
  if ("fatigueCount" in settings) {
    normalizedSettings.fatigueCount = normalizeNumber(
      settings.fatigueCount,
      antiBotDefaults.FATIGUE_AFTER_QUESTIONS || 10,
      1
    );
  }
  if ("fatigueMinMinutes" in settings) {
    normalizedSettings.fatigueMinMinutes = normalizeNumber(
      settings.fatigueMinMinutes,
      0.5,
      0.5
    );
  }
  if ("fatigueMaxMinutes" in settings) {
    normalizedSettings.fatigueMaxMinutes = normalizeNumber(
      settings.fatigueMaxMinutes,
      normalizedSettings.fatigueMinMinutes || 1,
      normalizedSettings.fatigueMinMinutes || 0.5
    );
  }

  return Object.keys(normalizedSettings).length > 0 ? normalizedSettings : undefined;
}

export function normalizeTemplates(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((template) => template && typeof template === "object")
    .map((template, index) => {
      const normalizedTemplate = {
        id: String(template.id || `template-${index + 1}`),
        name: String(template.name || `Template ${index + 1}`).trim(),
        content: String(template.content || "")
      };

      const normalizedSettings = normalizeTemplateSettings(template.settings);
      if (normalizedSettings) {
        normalizedTemplate.settings = normalizedSettings;
      }

      if ("useExtraction" in template) {
        normalizedTemplate.useExtraction = template.useExtraction === true;
      }
      if ("extractionRegex" in template) {
        normalizedTemplate.extractionRegex = normalizeString(
          template.extractionRegex,
          extractionDefaults.DEFAULT_REGEX
        );
      }
      if ("injectionPlaceholder" in template) {
        normalizedTemplate.injectionPlaceholder = normalizeString(
          template.injectionPlaceholder,
          extractionDefaults.DEFAULT_PLACEHOLDER
        );
      }

      return normalizedTemplate;
    });
}
