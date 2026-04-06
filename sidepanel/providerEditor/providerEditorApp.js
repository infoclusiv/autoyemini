let allProviders = {};
let selectedProviderId = null;
let isNewMode = false;

const CUSTOM_PROVIDERS_KEY = globalThis.CONFIG?.STORAGE_KEYS?.CUSTOM_PROVIDERS || "customProviders";

function sendMsg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function createEmptyProvider() {
  return {
    id: "",
    label: "",
    BASE_URL: "",
    HOSTNAME: "",
    TEMP_CHAT_PARAM: "",
    supportsWebSearch: false,
    supportsTempChat: false,
    supportsSSE: false,
    isBuiltIn: false,
    selectors: {}
  };
}

function getSortedProviderEntries() {
  return Object.entries(allProviders).sort((a, b) => {
    const aConfig = a[1] || {};
    const bConfig = b[1] || {};
    const aWeight = aConfig.isBuiltIn ? 0 : 1;
    const bWeight = bConfig.isBuiltIn ? 0 : 1;

    if (aWeight !== bWeight) {
      return aWeight - bWeight;
    }

    return String(aConfig.label || a[0]).localeCompare(String(bConfig.label || b[0]));
  });
}

function getDefaultProviderId() {
  const entries = getSortedProviderEntries();
  const preferredCustom = entries.find(([, provider]) => provider?.isBuiltIn !== true);
  return preferredCustom?.[0] || entries[0]?.[0] || null;
}

function clearTestResults() {
  document.querySelectorAll(".pe-test-result").forEach((element) => {
    element.className = "pe-test-result";
    element.textContent = "";
  });
}

function showEmptyState() {
  document.getElementById("peEmptyState").style.display = "flex";
  document.getElementById("peForm").style.display = "none";
  clearTestResults();
}

function showToast(message) {
  const existing = document.querySelector(".pe-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "pe-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

function showForm(provider, newMode) {
  isNewMode = newMode;
  document.getElementById("peEmptyState").style.display = "none";
  document.getElementById("peForm").style.display = "block";

  const isBuiltIn = provider.isBuiltIn === true;
  const selectors = provider.selectors || {};
  const idField = document.getElementById("peId");
  const formControls = document.querySelectorAll("#peForm input, #peForm select, #peForm button.pe-test-btn");

  document.getElementById("peFormTitle").textContent = newMode
    ? "New Provider"
    : (provider.label || provider.id || "Provider");

  document.getElementById("peDeleteBtn").style.display = !newMode && !isBuiltIn ? "inline-flex" : "none";
  document.getElementById("peSaveBtn").style.display = isBuiltIn ? "none" : "inline-flex";

  idField.value = newMode ? "" : (provider.id || "");
  idField.disabled = isBuiltIn || !newMode;

  document.getElementById("peLabel").value = provider.label || "";
  document.getElementById("peBaseUrl").value = provider.BASE_URL || "";
  document.getElementById("peHostname").value = provider.HOSTNAME || "";
  document.getElementById("peTempChatParam").value = provider.TEMP_CHAT_PARAM || "";

  document.querySelectorAll("input[name='submitMethod']").forEach((radio) => {
    radio.checked = radio.value === (selectors.submitMethod || "enter");
  });

  document.getElementById("selInput").value = selectors.input || "";
  document.getElementById("selInputFallback1").value = selectors.inputFallback1 || "";
  document.getElementById("selInputFallback2").value = selectors.inputFallback2 || "";
  document.getElementById("selSubmitButton").value = selectors.submitButton || "";
  document.getElementById("selStopButton").value = selectors.stopButton || "";
  document.getElementById("selResponseContainer").value = selectors.responseContainer || "";
  document.getElementById("selResponseContainerFallback1").value = selectors.responseContainerFallback1 || "";
  document.getElementById("selResponseContainerFallback2").value = selectors.responseContainerFallback2 || "";
  document.getElementById("selLoadingIndicator").value = selectors.loadingIndicator || "";

  document.getElementById("peSupportsWebSearch").checked = provider.supportsWebSearch === true;
  document.getElementById("peSupportsTempChat").checked = provider.supportsTempChat === true;

  formControls.forEach((element) => {
    element.disabled = isBuiltIn;
  });
  idField.disabled = isBuiltIn || !newMode;

  clearTestResults();
}

function renderSidebar() {
  const list = document.getElementById("providerList");
  list.innerHTML = "";

  const entries = getSortedProviderEntries();
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pe-hint";
    empty.style.padding = "12px";
    empty.textContent = "No providers available.";
    list.appendChild(empty);
    return;
  }

  entries.forEach(([id, provider]) => {
    const item = document.createElement("div");
    item.className = "pe-provider-item" + (!isNewMode && id === selectedProviderId ? " active" : "");

    const name = document.createElement("span");
    name.className = "pe-provider-item-name";
    name.textContent = provider.label || id;

    const badge = document.createElement("span");
    badge.className = "pe-provider-item-badge" + (provider.isBuiltIn ? " builtin" : "");
    badge.textContent = provider.isBuiltIn ? "built-in" : "custom";

    item.appendChild(name);
    item.appendChild(badge);
    item.addEventListener("click", () => {
      selectedProviderId = id;
      isNewMode = false;
      renderSidebar();
      showForm(allProviders[id], false);
    });

    list.appendChild(item);
  });
}

function renderCurrentSelection() {
  if (isNewMode) {
    showForm(createEmptyProvider(), true);
    return;
  }

  if (selectedProviderId && allProviders[selectedProviderId]) {
    showForm(allProviders[selectedProviderId], false);
    return;
  }

  showEmptyState();
}

async function loadProviders() {
  try {
    const response = await sendMsg("GET_ALL_PROVIDERS");
    allProviders = response && typeof response === "object" ? response : {};
  } catch {
    allProviders = {};
  }

  if (!isNewMode && (!selectedProviderId || !allProviders[selectedProviderId])) {
    selectedProviderId = getDefaultProviderId();
  }

  renderSidebar();
  renderCurrentSelection();
}

function collectFormValues() {
  const id = document.getElementById("peId").value.trim().toLowerCase().replace(/\s+/g, "-");
  const label = document.getElementById("peLabel").value.trim();
  const baseUrl = document.getElementById("peBaseUrl").value.trim();
  const hostnameField = document.getElementById("peHostname");
  const currentHostname = hostnameField.value.trim();

  let hostname = currentHostname;
  let urlPattern = currentHostname ? `https://${currentHostname}/*` : "";

  try {
    const parsedUrl = new URL(baseUrl);
    hostname = hostname || parsedUrl.hostname;
    urlPattern = `${parsedUrl.origin}/*`;
  } catch {
  }

  const submitMethod = document.querySelector("input[name='submitMethod']:checked")?.value || "enter";

  return {
    id,
    label,
    BASE_URL: baseUrl,
    HOSTNAME: hostname,
    TEMP_CHAT_PARAM: document.getElementById("peTempChatParam").value.trim(),
    URL_PATTERN: urlPattern,
    supportsWebSearch: document.getElementById("peSupportsWebSearch").checked,
    supportsTempChat: document.getElementById("peSupportsTempChat").checked,
    supportsSSE: false,
    isBuiltIn: false,
    selectors: {
      input: document.getElementById("selInput").value.trim() || null,
      inputFallback1: document.getElementById("selInputFallback1").value.trim() || null,
      inputFallback2: document.getElementById("selInputFallback2").value.trim() || null,
      submitButton: document.getElementById("selSubmitButton").value.trim() || null,
      stopButton: document.getElementById("selStopButton").value.trim() || null,
      responseContainer: document.getElementById("selResponseContainer").value.trim() || null,
      responseContainerFallback1: document.getElementById("selResponseContainerFallback1").value.trim() || null,
      responseContainerFallback2: document.getElementById("selResponseContainerFallback2").value.trim() || null,
      loadingIndicator: document.getElementById("selLoadingIndicator").value.trim() || null,
      submitMethod
    }
  };
}

function validateForm(values) {
  const errors = [];

  if (!values.id) errors.push("Provider ID is required.");
  if (!values.label) errors.push("Display Name is required.");
  if (!values.BASE_URL) errors.push("Base URL is required.");
  if (!values.HOSTNAME) errors.push("Hostname is required.");
  if (!values.selectors.input) errors.push("Prompt Input selector is required.");
  if (!values.selectors.responseContainer) errors.push("Response Container selector is required.");
  if (values.selectors.submitMethod === "button" && !values.selectors.submitButton) {
    errors.push("Submit Button selector is required when submit method is Click button.");
  }
  if (values.HOSTNAME.includes("://")) {
    errors.push("Hostname must not include the protocol.");
  }

  try {
    const parsedUrl = new URL(values.BASE_URL);
    if (values.HOSTNAME && parsedUrl.hostname !== values.HOSTNAME) {
      errors.push("Hostname must match the Base URL hostname.");
    }
  } catch {
    errors.push("Base URL must be a valid absolute URL.");
  }

  return errors;
}

async function handleSave() {
  const values = collectFormValues();
  const errors = validateForm(values);

  if (errors.length > 0) {
    window.alert(`Please fix these errors:\n\n${errors.join("\n")}`);
    return;
  }

  const response = await sendMsg("SAVE_CUSTOM_PROVIDER", { provider: values });
  if (!response?.success) {
    window.alert(`Error saving provider: ${response?.error || "Unknown error"}`);
    return;
  }

  isNewMode = false;
  selectedProviderId = values.id;
  await loadProviders();
  showToast("Provider saved.");
}

async function handleDelete() {
  if (!selectedProviderId || !allProviders[selectedProviderId]) {
    return;
  }

  const provider = allProviders[selectedProviderId];
  const confirmed = window.confirm(`Delete provider "${provider.label || selectedProviderId}"? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  const response = await sendMsg("DELETE_CUSTOM_PROVIDER", { providerId: selectedProviderId });
  if (!response?.success) {
    window.alert(`Error deleting provider: ${response?.error || "Unknown error"}`);
    return;
  }

  selectedProviderId = null;
  isNewMode = false;
  await loadProviders();
  showToast("Provider deleted.");
}

async function handleTestSelector(inputId, label) {
  const input = document.getElementById(inputId);
  const resultElement = document.getElementById(`${inputId}-result`);
  const selector = input?.value?.trim() || "";
  const providerHostname = document.getElementById("peHostname").value.trim();

  if (!resultElement) {
    return;
  }

  if (!selector) {
    resultElement.className = "pe-test-result error";
    resultElement.textContent = "Enter a selector first.";
    return;
  }

  if (!providerHostname) {
    resultElement.className = "pe-test-result error";
    resultElement.textContent = "Fill in the Hostname first so the editor can find the provider tab.";
    return;
  }

  resultElement.className = "pe-test-result testing";
  resultElement.textContent = "Testing selector...";

  const response = await sendMsg("TEST_SELECTOR", {
    selector,
    providerHostname
  });

  if (!response?.success) {
    resultElement.className = "pe-test-result error";
    resultElement.textContent = response?.error || "Could not test selector.";
    return;
  }

  const result = response.result || {};
  if (result.error) {
    resultElement.className = "pe-test-result error";
    resultElement.textContent = `${label}: ${result.error}`;
    return;
  }

  if (!result.found) {
    resultElement.className = "pe-test-result error";
    resultElement.textContent = `${label}: no matching elements found.`;
    return;
  }

  const visibilityNote = result.isVisible ? "" : " (found but hidden)";
  const preview = result.preview ? ` Preview: ${result.preview}` : "";
  resultElement.className = "pe-test-result success";
  resultElement.textContent = `Found ${result.count} <${result.tagName}> element(s)${visibilityNote}.${preview}`;
}

function setupEvents() {
  document.getElementById("newProviderBtn").addEventListener("click", () => {
    selectedProviderId = null;
    isNewMode = true;
    renderSidebar();
    showForm(createEmptyProvider(), true);
  });

  document.getElementById("peSaveBtn").addEventListener("click", () => {
    void handleSave();
  });

  document.getElementById("peDeleteBtn").addEventListener("click", () => {
    void handleDelete();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".pe-test-btn");
    if (!button) {
      return;
    }

    const selectorId = button.dataset.selector;
    const label = button.dataset.label || "Selector";
    if (selectorId) {
      void handleTestSelector(selectorId, label);
    }
  });

  document.getElementById("peBaseUrl").addEventListener("blur", (event) => {
    const hostnameField = document.getElementById("peHostname");
    if (hostnameField.value.trim()) {
      return;
    }

    try {
      const parsedUrl = new URL(event.target.value.trim());
      hostnameField.value = parsedUrl.hostname;
    } catch {
    }
  });
}

async function init() {
  setupEvents();
  await loadProviders();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[CUSTOM_PROVIDERS_KEY]) {
      return;
    }

    void loadProviders();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});