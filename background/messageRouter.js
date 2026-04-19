async function handleProcessQuestion(payload, sendResponse) {
  try {
    const useTempChat = payload.useTempChat !== false;
    const useWebSearch = payload.useWebSearch !== false;
    const keepSameChat = payload.keepSameChat === true;
    const tab = await findOrCreateChatGPTTab(useTempChat, keepSameChat);

    let ready = await waitForContentScript(tab.id);
    if (!ready) {
      await chrome.tabs.reload(tab.id);
      await SharedUtils.sleep(CONFIG.TIMING.SSE_READY_WAIT_MS);
      await waitForTabLoad(tab.id);
      ready = await waitForContentScript(tab.id);
    }

    if (!ready) {
      throw new Error(
        "Content script not ready even after page refresh. Please try manually refreshing the Google AI Studio page (F5)."
      );
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "ASK_QUESTION",
      question: payload.question,
      questionId: payload.questionId,
      useTempChat,
      useWebSearch,
      antiBotConfig: payload.antiBotConfig || null
    });

    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleOpenChatGPT(payload, sendResponse) {
  try {
    const tab = await findOrCreateChatGPTTab(
      payload.useTempChat !== false,
      payload.keepSameChat === true
    );
    sendResponse({ success: true, tabId: tab.id });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "PROCESS_QUESTION":
        handleProcessQuestion(message, sendResponse);
        return true;
      case "OPEN_CHATGPT":
        handleOpenChatGPT(message, sendResponse);
        return true;
      case "UPDATE_PROGRESS":
      case "LOG_MESSAGE":
        forwardToSidePanel(message);
        break;
      case "QUESTION_COMPLETE":
        void (async () => {
          const handledRemotely = await globalThis.ChatGPTRemoteRuntime.handleQuestionComplete(message.result);
          forwardToSidePanel(message);
          sendResponse({ received: true, remoteHandled: handledRemotely === true });
        })();
        return true;
      case "ENSURE_REMOTE_BRIDGE":
        void ChatGPTRemoteBridge.ensureConnected("runtime-message").then((ok) => {
          sendResponse({ success: ok === true });
        });
        return true;
      default:
        break;
    }

    return false;
  });
}