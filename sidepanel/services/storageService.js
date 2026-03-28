const storageKeys = globalThis.CONFIG?.STORAGE_KEYS || {
  QUESTIONS: "questions",
  TEMPLATES: "savedTemplates",
  USE_TEMP_CHAT: "useTempChat",
  USE_WEB_SEARCH: "useWebSearch",
  KEEP_SAME_CHAT: "keepSameChat",
  SINGLE_PROMPT_MODE: "singlePromptMode",
  USE_EXTRACTION: "useExtraction",
  EXTRACTION_REGEX: "extractionRegex",
  INJECTION_PLACEHOLDER: "injectionPlaceholder",
  PENDING_MESSAGE: "pendingMessage",
  HUMAN_TYPING: "humanTyping",
  RANDOM_DELAYS: "randomDelays",
  BIOLOGICAL_PAUSES: "biologicalPauses",
  TYPING_SPEED: "typingSpeed",
  FATIGUE_COUNT: "fatigueCount",
  FATIGUE_MIN_PAUSE_MINUTES: "fatigueMinPauseMinutes",
  FATIGUE_MAX_PAUSE_MINUTES: "fatigueMaxPauseMinutes"
};

const antiBotDefaults = globalThis.CONFIG?.ANTI_BOT || {
  TYPING_SPEED_MS: [30, 100],
  FATIGUE_AFTER_QUESTIONS: 10,
  FATIGUE_PAUSE_MS: [20000, 40000]
};

const extractionDefaults = globalThis.CONFIG?.EXTRACTION || {
  DEFAULT_REGEX: "<extract>(.*?)</extract>",
  DEFAULT_PLACEHOLDER: "{{extract}}"
};

function normalizeRange(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    const first = Number(value[0]) || fallback[0];
    const second = Number(value[1]) || first;
    return [Math.min(first, second), Math.max(first, second)];
  }

  return [...fallback];
}

function normalizeNumber(value, fallback, minValue = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(minValue, numericValue);
}

function msToMinutes(ms) {
  return Math.max(0.5, Math.round((Number(ms) / 60000) * 10) / 10);
}

function normalizeTemplateSettings(settings) {
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

function normalizeTemplates(value) {
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

function normalizeString(value, fallback) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || fallback;
}

export const StorageKeys = storageKeys;

export async function loadAll() {
  const stored = await chrome.storage.local.get([
    StorageKeys.QUESTIONS,
    StorageKeys.TEMPLATES,
    StorageKeys.USE_TEMP_CHAT,
    StorageKeys.USE_WEB_SEARCH,
    StorageKeys.KEEP_SAME_CHAT,
    StorageKeys.SINGLE_PROMPT_MODE,
    StorageKeys.USE_EXTRACTION,
    StorageKeys.EXTRACTION_REGEX,
    StorageKeys.INJECTION_PLACEHOLDER,
    StorageKeys.HUMAN_TYPING,
    StorageKeys.RANDOM_DELAYS,
    StorageKeys.BIOLOGICAL_PAUSES,
    StorageKeys.TYPING_SPEED,
    StorageKeys.FATIGUE_COUNT,
    StorageKeys.FATIGUE_MIN_PAUSE_MINUTES,
    StorageKeys.FATIGUE_MAX_PAUSE_MINUTES
  ]);

  const defaultTypingSpeed = normalizeRange(antiBotDefaults.TYPING_SPEED_MS, [30, 100]);
  const defaultFatiguePauseMs = normalizeRange(antiBotDefaults.FATIGUE_PAUSE_MS, [20000, 40000]);
  const fatigueMinMinutes = normalizeNumber(
    stored[StorageKeys.FATIGUE_MIN_PAUSE_MINUTES],
    msToMinutes(defaultFatiguePauseMs[0]),
    0.5
  );
  const fatigueMaxMinutes = normalizeNumber(
    stored[StorageKeys.FATIGUE_MAX_PAUSE_MINUTES],
    msToMinutes(defaultFatiguePauseMs[1]),
    fatigueMinMinutes
  );

  return {
    questions: stored[StorageKeys.QUESTIONS] || [],
    templates: normalizeTemplates(stored[StorageKeys.TEMPLATES]),
    useTempChat: stored[StorageKeys.USE_TEMP_CHAT] !== false,
    useWebSearch: stored[StorageKeys.USE_WEB_SEARCH] !== false,
    keepSameChat: stored[StorageKeys.KEEP_SAME_CHAT] === true,
    singlePromptMode: stored[StorageKeys.SINGLE_PROMPT_MODE] === true,
    useExtraction: stored[StorageKeys.USE_EXTRACTION] === true,
    extractionRegex: normalizeString(
      stored[StorageKeys.EXTRACTION_REGEX],
      extractionDefaults.DEFAULT_REGEX
    ),
    injectionPlaceholder: normalizeString(
      stored[StorageKeys.INJECTION_PLACEHOLDER],
      extractionDefaults.DEFAULT_PLACEHOLDER
    ),
    humanTyping: stored[StorageKeys.HUMAN_TYPING] !== false,
    randomDelays: stored[StorageKeys.RANDOM_DELAYS] !== false,
    biologicalPauses: stored[StorageKeys.BIOLOGICAL_PAUSES] === true,
    typingSpeed: normalizeRange(stored[StorageKeys.TYPING_SPEED], defaultTypingSpeed),
    fatigueCount: normalizeNumber(
      stored[StorageKeys.FATIGUE_COUNT],
      antiBotDefaults.FATIGUE_AFTER_QUESTIONS || 10,
      1
    ),
    fatigueMinMinutes,
    fatigueMaxMinutes
  };
}

export function saveQuestions(questions) {
  return chrome.storage.local.set({ [StorageKeys.QUESTIONS]: questions });
}

export function saveSetting(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

export function removePendingMessage() {
  return chrome.storage.local.remove(StorageKeys.PENDING_MESSAGE);
}