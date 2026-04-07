function getResolvedChatGPTConfig(providerConfig = null) {
  const configuredChatGPT = CONFIG.PROVIDERS?.chatgpt || {};
  const baseUrl = typeof providerConfig?.BASE_URL === "string" && providerConfig.BASE_URL.trim()
    ? providerConfig.BASE_URL.trim()
    : (configuredChatGPT.BASE_URL || CONFIG.CHATGPT.BASE_URL);
  const tempChatParam = typeof providerConfig?.TEMP_CHAT_PARAM === "string"
    ? providerConfig.TEMP_CHAT_PARAM.trim()
    : (configuredChatGPT.TEMP_CHAT_PARAM || CONFIG.CHATGPT.TEMP_CHAT_PARAM);
  const urlPattern = typeof providerConfig?.URL_PATTERN === "string" && providerConfig.URL_PATTERN.trim()
    ? providerConfig.URL_PATTERN.trim()
    : (configuredChatGPT.URL_PATTERN || CONFIG.CHATGPT.URL_PATTERN);
  const hostname = typeof providerConfig?.HOSTNAME === "string" && providerConfig.HOSTNAME.trim()
    ? providerConfig.HOSTNAME.trim()
    : (configuredChatGPT.HOSTNAME || "chatgpt.com");

  return {
    ...configuredChatGPT,
    ...providerConfig,
    id: "chatgpt",
    BASE_URL: baseUrl,
    TEMP_CHAT_PARAM: tempChatParam,
    URL_PATTERN: urlPattern,
    HOSTNAME: hostname,
    supportsTempChat:
      providerConfig?.supportsTempChat !== false && configuredChatGPT.supportsTempChat !== false
  };
}

function isChatGPTHost(providerConfig = null) {
  const resolvedChatGPT = getResolvedChatGPTConfig(providerConfig);

  if (resolvedChatGPT.HOSTNAME) {
    return resolvedChatGPT.HOSTNAME.includes("chatgpt.com");
  }

  try {
    return new URL(resolvedChatGPT.BASE_URL).hostname.includes("chatgpt.com");
  } catch {
    return true;
  }
}

function getChatGPTUrl(useTempChat, providerConfig = null) {
  const resolvedChatGPT = getResolvedChatGPTConfig(providerConfig);
  return useTempChat && resolvedChatGPT.supportsTempChat
    ? `${resolvedChatGPT.BASE_URL}${resolvedChatGPT.TEMP_CHAT_PARAM || ""}`
    : resolvedChatGPT.BASE_URL;
}

function getProviderUrl(providerConfig, useTempChat) {
  if (!providerConfig) {
    return getChatGPTUrl(useTempChat);
  }

  const tempParam = useTempChat && providerConfig.supportsTempChat
    ? providerConfig.TEMP_CHAT_PARAM || ""
    : "";

  return `${providerConfig.BASE_URL}${tempParam}`;
}

function canReuseExistingChat(currentUrl, providerConfig = null) {
  if (!currentUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(currentUrl);
    const resolvedChatGPT = getResolvedChatGPTConfig(providerConfig);
    const baseUrl = new URL(resolvedChatGPT.BASE_URL);

    if (parsedUrl.origin !== baseUrl.origin) {
      return false;
    }

    return parsedUrl.pathname === "/" || parsedUrl.pathname.startsWith("/c/");
  } catch {
    return false;
  }
}

function canReuseProviderTab(currentUrl, providerConfig) {
  if (!currentUrl || !providerConfig) {
    return false;
  }

  try {
    const parsedUrl = new URL(currentUrl);
    const baseUrl = new URL(providerConfig.BASE_URL);

    if (parsedUrl.origin !== baseUrl.origin) {
      return false;
    }

    if (providerConfig.id === "chatgpt" && isChatGPTHost(providerConfig)) {
      return parsedUrl.pathname === "/" || parsedUrl.pathname.startsWith("/c/");
    }

    return parsedUrl.hostname === baseUrl.hostname;
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

async function findOrCreateChatGPTTab(providerConfig, useTempChat, keepSameChat = false) {
  const resolvedChatGPT = getResolvedChatGPTConfig(providerConfig);
  const url = getChatGPTUrl(useTempChat, resolvedChatGPT);
  const urlPattern = resolvedChatGPT.URL_PATTERN || CONFIG.CHATGPT.URL_PATTERN;
  const existingTabs = await chrome.tabs.query({ url: urlPattern });

  if (existingTabs.length > 0) {
    const currentTab = existingTabs[0];
    const tab = await chrome.tabs.update(currentTab.id, { active: true });

    let needsReload = false;

    if (keepSameChat) {
      needsReload = !canReuseExistingChat(currentTab.url, resolvedChatGPT);
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

async function findOrCreateProviderTab(providerConfig, useTempChat, keepSameChat = false) {
  if (!providerConfig) {
    return findOrCreateChatGPTTab(null, useTempChat, keepSameChat);
  }

  if (providerConfig.id === "chatgpt" && isChatGPTHost(providerConfig)) {
    return findOrCreateChatGPTTab(providerConfig, useTempChat, keepSameChat);
  }

  const url = getProviderUrl(providerConfig, useTempChat);
  const urlPattern = providerConfig.URL_PATTERN || `${new URL(providerConfig.BASE_URL).origin}/*`;
  const existingTabs = await chrome.tabs.query({ url: urlPattern });

  if (existingTabs.length > 0) {
    const currentTab = existingTabs[0];
    const tab = await chrome.tabs.update(currentTab.id, { active: true });

    let needsReload = false;

    if (keepSameChat) {
      needsReload = !canReuseProviderTab(currentTab.url, providerConfig);
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