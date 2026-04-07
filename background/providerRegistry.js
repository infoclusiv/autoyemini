const CUSTOM_PROVIDERS_KEY = CONFIG.STORAGE_KEYS?.CUSTOM_PROVIDERS || "customProviders";
const BUILTIN_PROVIDER_OVERRIDES_KEY =
  CONFIG.STORAGE_KEYS?.BUILTIN_PROVIDER_OVERRIDES || "builtinProviderOverrides";
const RESERVED_PROVIDER_IDS = new Set(["received", "success", "error"]);

function normalizeStoredProviders(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeProviderId(value, fallbackValue = "") {
  const candidate = typeof value === "string" && value.trim()
    ? value.trim()
    : (typeof fallbackValue === "string" ? fallbackValue.trim() : "");

  return candidate;
}

function normalizeSelectors(selectors) {
  if (!selectors || typeof selectors !== "object" || Array.isArray(selectors)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(selectors)
      .filter(([key]) => typeof key === "string" && key.trim())
      .map(([key, value]) => {
        if (value === null) {
          return [key, null];
        }

        if (typeof value === "string") {
          const trimmed = value.trim();
          return [key, trimmed || null];
        }

        return [key, null];
      })
  );
}

function normalizeProviderConfig(providerConfig = {}, fallbackId = "") {
  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return null;
  }

  const id = normalizeProviderId(providerConfig.id, fallbackId);

  if (!id || RESERVED_PROVIDER_IDS.has(id)) {
    return null;
  }

  return {
    ...providerConfig,
    id,
    label: typeof providerConfig.label === "string" && providerConfig.label.trim()
      ? providerConfig.label.trim()
      : id,
    BASE_URL: typeof providerConfig.BASE_URL === "string" ? providerConfig.BASE_URL.trim() : "",
    HOSTNAME: typeof providerConfig.HOSTNAME === "string" ? providerConfig.HOSTNAME.trim() : "",
    TEMP_CHAT_PARAM:
      typeof providerConfig.TEMP_CHAT_PARAM === "string" ? providerConfig.TEMP_CHAT_PARAM.trim() : "",
    URL_PATTERN: typeof providerConfig.URL_PATTERN === "string" ? providerConfig.URL_PATTERN.trim() : "",
    supportsWebSearch: providerConfig.supportsWebSearch === true,
    supportsTempChat: providerConfig.supportsTempChat === true,
    supportsSSE: providerConfig.supportsSSE === true,
    isBuiltIn: providerConfig.isBuiltIn === true,
    selectors: normalizeSelectors(providerConfig.selectors)
  };
}

function normalizeProviderCollection(value, options = {}) {
  const {
    allowedIds = null,
    disallowedIds = null,
    markBuiltIn = false
  } = options;

  const providers = {};

  Object.entries(normalizeStoredProviders(value)).forEach(([storedId, providerConfig]) => {
    const normalizedProvider = normalizeProviderConfig(providerConfig, storedId);
    if (!normalizedProvider) {
      return;
    }

    if (allowedIds && !allowedIds.has(normalizedProvider.id)) {
      return;
    }

    if (disallowedIds && disallowedIds.has(normalizedProvider.id)) {
      return;
    }

    providers[normalizedProvider.id] = markBuiltIn
      ? { ...normalizedProvider, isBuiltIn: true }
      : normalizedProvider;
  });

  return providers;
}

function mergeProviderConfig(baseProvider, overrideProvider) {
  const normalizedBase = normalizeProviderConfig(baseProvider, baseProvider?.id);
  const normalizedOverride = normalizeProviderConfig(overrideProvider, normalizedBase?.id);

  if (!normalizedBase) {
    return normalizedOverride;
  }

  if (!normalizedOverride) {
    return normalizedBase;
  }

  return normalizeProviderConfig(
    {
      ...normalizedBase,
      ...normalizedOverride,
      id: normalizedBase.id,
      isBuiltIn: true,
      selectors: {
        ...(normalizedBase.selectors || {}),
        ...(normalizedOverride.selectors || {})
      }
    },
    normalizedBase.id
  );
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
  const baseProviders = normalizeProviderCollection(CONFIG.PROVIDERS, { markBuiltIn: true });
  const builtInIds = new Set(Object.keys(baseProviders));

  try {
    const stored = await chrome.storage.local.get([
      CUSTOM_PROVIDERS_KEY,
      BUILTIN_PROVIDER_OVERRIDES_KEY
    ]);
    const customProviders = normalizeProviderCollection(stored[CUSTOM_PROVIDERS_KEY], {
      disallowedIds: builtInIds
    });
    const builtInOverrides = normalizeProviderCollection(stored[BUILTIN_PROVIDER_OVERRIDES_KEY], {
      allowedIds: builtInIds
    });

    const resolvedBuiltIns = Object.fromEntries(
      Object.entries(baseProviders).map(([id, provider]) => {
        const mergedProvider = mergeProviderConfig(provider, builtInOverrides[id]) || provider;
        return [
          id,
          {
            ...mergedProvider,
            id,
            isBuiltIn: true,
            hasOverride: Boolean(builtInOverrides[id])
          }
        ];
      })
    );

    return { ...customProviders, ...resolvedBuiltIns };
  } catch {
    return baseProviders;
  }
}

async function getCustomProviders() {
  const baseProviders = normalizeProviderCollection(CONFIG.PROVIDERS, { markBuiltIn: true });
  const builtInIds = new Set(Object.keys(baseProviders));

  try {
    const stored = await chrome.storage.local.get([CUSTOM_PROVIDERS_KEY]);
    return normalizeProviderCollection(stored[CUSTOM_PROVIDERS_KEY], {
      disallowedIds: builtInIds
    });
  } catch {
    return {};
  }
}

async function getBuiltinProviderOverrides() {
  const baseProviders = normalizeProviderCollection(CONFIG.PROVIDERS, { markBuiltIn: true });
  const builtInIds = new Set(Object.keys(baseProviders));

  try {
    const stored = await chrome.storage.local.get([BUILTIN_PROVIDER_OVERRIDES_KEY]);
    return normalizeProviderCollection(stored[BUILTIN_PROVIDER_OVERRIDES_KEY], {
      allowedIds: builtInIds
    });
  } catch {
    return {};
  }
}

async function saveCustomProvider(providerConfig) {
  const normalizedProvider = normalizeProviderConfig(providerConfig, providerConfig?.id);
  if (!normalizedProvider?.id) {
    return { success: false, error: "Provider ID is required" };
  }

  const { id } = normalizedProvider;

  if (CONFIG.PROVIDERS?.[id]) {
    try {
      const existingOverrides = await getBuiltinProviderOverrides();
      const updatedOverrides = {
        ...existingOverrides,
        [id]: { ...normalizedProvider, isBuiltIn: true }
      };

      await chrome.storage.local.set({ [BUILTIN_PROVIDER_OVERRIDES_KEY]: updatedOverrides });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
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
    try {
      const existingOverrides = await getBuiltinProviderOverrides();
      const { [providerId]: _removedOverride, ...updatedOverrides } = existingOverrides;
      await chrome.storage.local.set({ [BUILTIN_PROVIDER_OVERRIDES_KEY]: updatedOverrides });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
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