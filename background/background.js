importScripts(
  "../config.js",
  "../shared/utils.js",
  "tabManager.js",
  "sidePanelBridge.js",
  "chatgptWorkflowRuntime.js",
  "chatgptRemoteBridge.js",
  "messageRouter.js"
);

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

ChatGPTRemoteBridge.registerBridgeLifecycle();
void ChatGPTRemoteBridge.ensureConnected("background-init");

registerMessageRouter();