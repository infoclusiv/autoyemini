try {
  importScripts(
    "../config.js",
    "../shared/utils.js",
    "tabManager.js",
    "sidePanelBridge.js",
    "chatgptWorkflowRuntime.js",
    "chatgptRemoteBridge.js",
    "messageRouter.js"
  );
  console.info("[RemoteBridge:autoyemini] Background scripts loaded.");
} catch (error) {
  console.error("[RemoteBridge:autoyemini] Failed to load background scripts.", error);
  throw error;
}

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

try {
  console.info("[RemoteBridge:autoyemini] Service worker bootstrapping.");
  ChatGPTRemoteBridge.registerBridgeLifecycle();
  console.info("[RemoteBridge:autoyemini] Bridge lifecycle registered.");
  registerMessageRouter();
  console.info("[RemoteBridge:autoyemini] Message router registered.");
  void ChatGPTRemoteBridge.ensureConnected("background-init");
} catch (error) {
  console.error("[RemoteBridge:autoyemini] Service worker bootstrap failed.", error);
  throw error;
}