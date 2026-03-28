export function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

export function onRuntimeMessage(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handler(message, sendResponse);
    return true;
  });
}

export function onStorageChange(handler) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      handler(changes);
    }
  });
}