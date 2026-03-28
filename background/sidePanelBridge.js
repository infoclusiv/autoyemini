async function forwardToSidePanel(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
  }

  try {
    await chrome.storage.local.set({
      [CONFIG.STORAGE_KEYS.PENDING_MESSAGE]: {
        ...message,
        timestamp: Date.now()
      }
    });
  } catch {
  }
}