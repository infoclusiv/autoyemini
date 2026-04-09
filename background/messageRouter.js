async function handleProcessQuestion(payload, sendResponse) {
  try {
    const providerId = payload.providerId || "chatgpt";
    const providerConfig = await getProviderById(providerId) || CONFIG.PROVIDERS?.chatgpt;
    const providerLabel = providerConfig?.label || providerId || "provider";
    const useTempChat = payload.useTempChat !== false;
    const useWebSearch = payload.useWebSearch !== false;
    const keepSameChat = payload.keepSameChat === true;
    const tab = await findOrCreateProviderTab(providerConfig, useTempChat, keepSameChat);

    let ready = await waitForContentScript(tab.id);
    if (!ready) {
      await chrome.tabs.reload(tab.id);
      await SharedUtils.sleep(CONFIG.TIMING.SSE_READY_WAIT_MS);
      await waitForTabLoad(tab.id);
      ready = await waitForContentScript(tab.id);
    }

    if (!ready) {
      throw new Error(
        `Content script not ready even after page refresh. Please try manually refreshing the ${providerLabel} page (F5).`
      );
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "ASK_QUESTION",
      question: payload.question,
      questionId: payload.questionId,
      useTempChat,
      useWebSearch,
      providerConfig,
      antiBotConfig: payload.antiBotConfig || null
    });

    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleOpenChatGPT(payload, sendResponse) {
  try {
    const providerId = payload.providerId || "chatgpt";
    const providerConfig = await getProviderById(providerId) || CONFIG.PROVIDERS?.chatgpt;

    const tab = await findOrCreateProviderTab(
      providerConfig,
      payload.useTempChat !== false,
      payload.keepSameChat === true
    );
    sendResponse({ success: true, tabId: tab.id });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleOpenProvider(payload, sendResponse) {
  return handleOpenChatGPT(payload, sendResponse);
}

async function handleTestSelector(payload, sendResponse) {
  try {
    const selector = typeof payload.selector === "string" ? payload.selector.trim() : "";
    const providerHostname = typeof payload.providerHostname === "string"
      ? payload.providerHostname.trim()
      : "";

    if (!selector) {
      sendResponse({ success: false, error: "Selector vacio" });
      return;
    }

    let targetTab = null;
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

    if (providerHostname) {
      const matchingTabs = await chrome.tabs.query({});
      targetTab = matchingTabs.find((tab) => {
        if (!tab.url) {
          return false;
        }

        try {
          return new URL(tab.url).hostname.includes(providerHostname);
        } catch {
          return false;
        }
      }) || null;
    }

    if (!targetTab) {
      targetTab = activeTabs[0] || null;
    }

    if (!targetTab?.id) {
      sendResponse({
        success: false,
        error: "No se encontro el tab del provider. Abre el sitio en Chrome primero."
      });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: (selectorStr) => {
        try {
          const elements = document.querySelectorAll(selectorStr);

          if (elements.length === 0) {
            return { found: false, count: 0, preview: null };
          }

          const last = elements[elements.length - 1];
          const preview = (last.innerText || last.textContent || last.value || "")
            .substring(0, 100)
            .trim();

          return {
            found: true,
            count: elements.length,
            tagName: last.tagName,
            preview: preview || "(elemento sin texto visible)",
            isVisible: last.offsetParent !== null
          };
        } catch (error) {
          return { found: false, count: 0, error: error.message };
        }
      },
      args: [selector]
    });

    const result = results?.[0]?.result;
    if (!result) {
      sendResponse({ success: false, error: "No se pudo ejecutar el selector en el tab" });
      return;
    }

    sendResponse({ success: true, result, tabId: targetTab.id });
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
        handleOpenProvider(message, sendResponse);
        return true;
      case "GET_ALL_PROVIDERS":
        getAllProviders()
          .then((providers) => sendResponse(providers || {}))
          .catch(() => sendResponse({}));
        return true;
      case "GET_CUSTOM_PROVIDERS":
        getCustomProviders()
          .then((providers) => sendResponse(providers || {}))
          .catch(() => sendResponse({}));
        return true;
      case "SAVE_CUSTOM_PROVIDER":
        saveCustomProvider(message.provider).then(sendResponse);
        return true;
      case "DELETE_CUSTOM_PROVIDER":
        deleteCustomProvider(message.providerId).then(sendResponse);
        return true;
      case "TEST_SELECTOR":
        handleTestSelector(message, sendResponse);
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