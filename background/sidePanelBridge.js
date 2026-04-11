async function forwardToSidePanel(message) {
  let delivered = false;

  try {
    const response = await chrome.runtime.sendMessage(message);
    delivered = Boolean(response?.received);
  } catch {
  }

  if (delivered) {
    return true;
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

  return false;
}