const CUSTOM_PROVIDERS_KEY = CONFIG.STORAGE_KEYS?.CUSTOM_PROVIDERS || "customProviders";

function normalizeStoredProviders(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeProviderConfig(providerConfig = {}) {
  const id = typeof providerConfig.id === "string" ? providerConfig.id.trim() : "";

  return {
    ...providerConfig,
    id,
    label: typeof providerConfig.label === "string" && providerConfig.label.trim()
      ? providerConfig.label.trim()
      : id,
    selectors: providerConfig.selectors && typeof providerConfig.selectors === "object"
      ? { ...providerConfig.selectors }
      : {}
  };
}

function hostnamesMatch(hostname, providerHostname) {
  if (!hostname || !providerHostname) {
    return false;
  }

  const normalizedHostname = String(hostname).toLowerCase();
  const normalizedProviderHostname = String(providerHostname).toLowerCase();

  return (
    normalizedHostname === normalizedProviderHostname ||
    normalizedHostname.endsWith(`.${normalizedProviderHostname}`) ||
    normalizedHostname.includes(normalizedProviderHostname)
  );
}

async function getAllProviders() {
  const baseProviders = normalizeStoredProviders(CONFIG.PROVIDERS);

  try {
    const stored = await chrome.storage.local.get([CUSTOM_PROVIDERS_KEY]);
    const customProviders = normalizeStoredProviders(stored[CUSTOM_PROVIDERS_KEY]);

    return Object.fromEntries(
      Object.entries({ ...customProviders, ...baseProviders }).map(([id, provider]) => [
        id,
        normalizeProviderConfig(provider)
      ])
    );
  } catch {
    return Object.fromEntries(
      Object.entries(baseProviders).map(([id, provider]) => [id, normalizeProviderConfig(provider)])
    );
  }
}

async function getCustomProviders() {
  try {
    const stored = await chrome.storage.local.get([CUSTOM_PROVIDERS_KEY]);
    const customProviders = normalizeStoredProviders(stored[CUSTOM_PROVIDERS_KEY]);

    return Object.fromEntries(
      Object.entries(customProviders).map(([id, provider]) => [id, normalizeProviderConfig(provider)])
    );
  } catch {
    return {};
  }
}

async function saveCustomProvider(providerConfig) {
  const normalizedProvider = normalizeProviderConfig(providerConfig);
  const { id } = normalizedProvider;

  if (!id) {
    return { success: false, error: "Provider ID is required" };
  }

  if (CONFIG.PROVIDERS?.[id]) {
    return { success: false, error: `Cannot overwrite built-in provider: ${id}` };
  }

  try {
    const existingProviders = await getCustomProviders();
    const updatedProviders = { ...existingProviders, [id]: normalizedProvider };
    await chrome.storage.local.set({ [CUSTOM_PROVIDERS_KEY]: updatedProviders });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deleteCustomProvider(providerId) {
  if (CONFIG.PROVIDERS?.[providerId]) {
    return { success: false, error: `Cannot delete built-in provider: ${providerId}` };
  }

  try {
    const existingProviders = await getCustomProviders();
    const { [providerId]: _removedProvider, ...updatedProviders } = existingProviders;
    await chrome.storage.local.set({ [CUSTOM_PROVIDERS_KEY]: updatedProviders });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function findProviderByHostname(hostname) {
  const providers = await getAllProviders();

  for (const provider of Object.values(providers)) {
    if (hostnamesMatch(hostname, provider.HOSTNAME)) {
      return provider;
    }
  }

  return null;
}

async function getProviderById(providerId) {
  const providers = await getAllProviders();
  return providers[providerId] || null;
}