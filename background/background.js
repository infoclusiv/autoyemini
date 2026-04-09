importScripts(
  "../config.js",
  "../shared/utils.js",
  "providerRegistry.js",
  "tabManager.js",
  "sidePanelBridge.js",
  "aiStudioBridgeClient.js",
  "messageRouter.js"
);

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

registerMessageRouter();