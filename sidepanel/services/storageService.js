const storageKeys = globalThis.CONFIG?.STORAGE_KEYS || {
  QUESTIONS: "questions",
  USE_TEMP_CHAT: "useTempChat",
  USE_WEB_SEARCH: "useWebSearch",
  KEEP_SAME_CHAT: "keepSameChat",
  PENDING_MESSAGE: "pendingMessage"
};

export const StorageKeys = storageKeys;

export async function loadAll() {
  const stored = await chrome.storage.local.get([
    StorageKeys.QUESTIONS,
    StorageKeys.USE_TEMP_CHAT,
    StorageKeys.USE_WEB_SEARCH,
    StorageKeys.KEEP_SAME_CHAT
  ]);

  return {
    questions: stored[StorageKeys.QUESTIONS] || [],
    useTempChat: stored[StorageKeys.USE_TEMP_CHAT] !== false,
    useWebSearch: stored[StorageKeys.USE_WEB_SEARCH] !== false,
    keepSameChat: stored[StorageKeys.KEEP_SAME_CHAT] === true
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