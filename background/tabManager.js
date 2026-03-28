function getChatGPTUrl(useTempChat) {
  return useTempChat
    ? `${CONFIG.CHATGPT.BASE_URL}${CONFIG.CHATGPT.TEMP_CHAT_PARAM}`
    : CONFIG.CHATGPT.BASE_URL;
}

function canReuseExistingChat(currentUrl) {
  if (!currentUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(currentUrl);
    const baseUrl = new URL(CONFIG.CHATGPT.BASE_URL);

    if (parsedUrl.origin !== baseUrl.origin) {
      return false;
    }

    return parsedUrl.pathname === "/" || parsedUrl.pathname.startsWith("/c/");
  } catch {
    return false;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, CONFIG.TIMING.PAGE_LOAD_WAIT_MS);
      }
    });
  });
}

async function findOrCreateChatGPTTab(useTempChat, keepSameChat = false) {
  const url = getChatGPTUrl(useTempChat);
  const existingTabs = await chrome.tabs.query({ url: CONFIG.CHATGPT.URL_PATTERN });

  if (existingTabs.length > 0) {
    const currentTab = existingTabs[0];
    const tab = await chrome.tabs.update(currentTab.id, { active: true });

    let needsReload = false;

    if (keepSameChat) {
      needsReload = !canReuseExistingChat(currentTab.url);
    } else if (currentTab.url !== url) {
      needsReload = true;
    }

    if (needsReload) {
      await chrome.tabs.update(currentTab.id, { url, active: true });
      await waitForTabLoad(currentTab.id);
    } else if (currentTab.status !== "complete") {
      await waitForTabLoad(currentTab.id);
    } else {
      await SharedUtils.sleep(CONFIG.TIMING.SSE_READY_WAIT_MS);
    }

    return tab;
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoad(tab.id);
  return tab;
}

async function waitForContentScript(tabId) {
  for (let attempt = 0; attempt < CONFIG.TIMING.CONTENT_SCRIPT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (response?.ready) {
        return true;
      }
    } catch {
      await SharedUtils.sleep(CONFIG.TIMING.CONTENT_SCRIPT_POLL_INTERVAL_MS);
    }
  }

  return false;
}