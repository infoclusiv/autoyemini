import { normalizeRange, normalizeNumber } from "./normalizers.js";
import { normalizeTemplates } from "./templateService.js";
import { normalizeWorkflows } from "./workflowService.js";

const storageKeys = globalThis.CONFIG?.STORAGE_KEYS || {
  QUESTIONS: "questions",
  TEMPLATES: "savedTemplates",
  USE_TEMP_CHAT: "useTempChat",
  USE_WEB_SEARCH: "useWebSearch",
  KEEP_SAME_CHAT: "keepSameChat",
  SINGLE_PROMPT_MODE: "singlePromptMode",
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

function msToMinutes(ms) {
  return Math.max(0.5, Math.round((Number(ms) / 60000) * 10) / 10);
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
    StorageKeys.HUMAN_TYPING,
    StorageKeys.RANDOM_DELAYS,
    StorageKeys.BIOLOGICAL_PAUSES,
    StorageKeys.TYPING_SPEED,
    StorageKeys.FATIGUE_COUNT,
    StorageKeys.FATIGUE_MIN_PAUSE_MINUTES,
    StorageKeys.FATIGUE_MAX_PAUSE_MINUTES,
    StorageKeys.WORKFLOWS
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

  const templates = normalizeTemplates(stored[StorageKeys.TEMPLATES]);

  return {
    questions: stored[StorageKeys.QUESTIONS] || [],
    templates,
    workflows: normalizeWorkflows(stored[StorageKeys.WORKFLOWS], templates),
    useTempChat: stored[StorageKeys.USE_TEMP_CHAT] !== false,
    useWebSearch: stored[StorageKeys.USE_WEB_SEARCH] !== false,
    keepSameChat: stored[StorageKeys.KEEP_SAME_CHAT] === true,
    singlePromptMode: stored[StorageKeys.SINGLE_PROMPT_MODE] === true,
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

export function saveWorkflows(workflows) {
  return chrome.storage.local.set({ [StorageKeys.WORKFLOWS]: workflows });
}