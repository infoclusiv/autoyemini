export function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

export function onRuntimeMessage(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      return handler(message, sender, sendResponse) === true;
    } catch {
      return false;
    }
  });
}

export function onStorageChange(handler) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      handler(changes);
    }
  });
}