async function handleProcessQuestion(payload, sendResponse) {
  try {
    const useTempChat = payload.useTempChat !== false;
    const useWebSearch = payload.useWebSearch !== false;
    const tab = await findOrCreateChatGPTTab(useTempChat);

    let ready = await waitForContentScript(tab.id);
    if (!ready) {
      await chrome.tabs.reload(tab.id);
      await SharedUtils.sleep(CONFIG.TIMING.SSE_READY_WAIT_MS);
      await waitForTabLoad(tab.id);
      ready = await waitForContentScript(tab.id);
    }

    if (!ready) {
      throw new Error(
        "Content script not ready even after page refresh. Please try manually refreshing the ChatGPT page (F5)."
      );
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "ASK_QUESTION",
      question: payload.question,
      questionId: payload.questionId,
      useTempChat,
      useWebSearch
    });

    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleOpenChatGPT(payload, sendResponse) {
  try {
    const tab = await findOrCreateChatGPTTab(payload.useTempChat !== false);
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
        forwardToSidePanel(message);
        sendResponse({ received: true });
        return true;
      default:
        break;
    }

    return false;
  });
}