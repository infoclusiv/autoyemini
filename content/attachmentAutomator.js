(function registerAttachmentAutomatorModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});

  const TRIGGER_TEXT_PATTERNS = [
    "attach",
    "upload",
    "add file",
    "add files",
    "insert asset",
    "insert assets",
    "subir",
    "adjuntar",
    "archivo",
    "archivos"
  ];
  const MENU_ITEM_TEXT_PATTERNS = [
    "upload file",
    "upload files",
    "subir archivo",
    "subir archivos",
    "import file",
    "import files",
    "datei hochladen",
    "dateien hochladen",
    "téléverser",
    "archivo local"
  ];

  function getSiteProfile() {
    return globalThis.CONFIG?.getSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {};
  }

  function getAttachmentSelectors() {
    return getSiteProfile().selectors || {};
  }

  function normalizeAttachmentDescriptor(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const attachmentId = typeof value.attachmentId === "string" ? value.attachmentId.trim() : "";
    if (!attachmentId) {
      return null;
    }

    return {
      attachmentId,
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : attachmentId,
      mimeType: typeof value.mimeType === "string" && value.mimeType.trim()
        ? value.mimeType.trim()
        : "application/octet-stream",
      downloadUrl: typeof value.downloadUrl === "string" && value.downloadUrl.trim()
        ? value.downloadUrl.trim()
        : globalThis.CONFIG?.REMOTE_API?.resolveAttachmentDownloadUrl?.(attachmentId)
          || `http://localhost:7788/api/extensions/autoyemini/attachments/${encodeURIComponent(attachmentId)}`
    };
  }

  function isElementVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function getElementSearchText(element) {
    return [
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      element?.textContent,
      element?.getAttribute?.("data-testid")
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
  }

  function matchesAnyPattern(text, patterns) {
    const normalizedText = String(text || "").toLowerCase();
    return patterns.some((pattern) => normalizedText.includes(pattern));
  }

  function querySelectorSafe(selector, root = document) {
    if (!selector || typeof selector !== "string") {
      return [];
    }

    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function findFileInput() {
    const selectors = getAttachmentSelectors();
    const candidates = querySelectorSafe(selectors.fileInput || 'input[type="file"]');
    return candidates.find((input) => input instanceof HTMLInputElement && input.type === "file" && !input.disabled) || null;
  }

  function findAttachmentTrigger() {
    const selectors = getAttachmentSelectors();
    const configured = querySelectorSafe(selectors.attachmentTrigger).find(isElementVisible);
    if (configured) {
      return configured;
    }

    const genericCandidates = Array.from(
      document.querySelectorAll('button, [role="button"], [tabindex]:not(input), summary')
    ).filter(isElementVisible);

    return genericCandidates.find((candidate) => {
      const searchText = getElementSearchText(candidate);
      return searchText === "+" || matchesAnyPattern(searchText, TRIGGER_TEXT_PATTERNS);
    }) || null;
  }

  function findUploadMenuItem() {
    const selectors = getAttachmentSelectors();
    const configured = querySelectorSafe(selectors.attachmentUploadMenuItem).find((candidate) => {
      return isElementVisible(candidate) && matchesAnyPattern(getElementSearchText(candidate), MENU_ITEM_TEXT_PATTERNS);
    });
    if (configured) {
      return configured;
    }

    const overlayCandidates = Array.from(
      document.querySelectorAll('div[style*="position: absolute"], div[style*="position: fixed"], [role="menu"], [role="listbox"]')
    );
    for (const overlay of overlayCandidates) {
      const candidate = Array.from(
        overlay.querySelectorAll('.__menu-item, [role="menuitem"], button, [role="button"]')
      ).find((item) => isElementVisible(item) && matchesAnyPattern(getElementSearchText(item), MENU_ITEM_TEXT_PATTERNS));
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function countReadyIndicators() {
    const selectors = getAttachmentSelectors();
    if (!selectors.attachmentReadyIndicator) {
      return 0;
    }

    return querySelectorSafe(selectors.attachmentReadyIndicator).filter(isElementVisible).length;
  }

  async function ensureUploadInput(antiBotConfig = {}) {
    const existingInput = findFileInput();
    if (existingInput) {
      return existingInput;
    }

    const trigger = findAttachmentTrigger();
    if (trigger) {
      await modules.clickElement(trigger, antiBotConfig);
      await modules.waitForDelay(
        globalThis.CONFIG?.ATTACHMENTS?.MENU_APPEAR_WAIT_MS || globalThis.CONFIG?.TIMING?.MENU_APPEAR_WAIT_MS || [900, 1600],
        antiBotConfig
      );
    }

    const afterTriggerInput = findFileInput();
    if (afterTriggerInput) {
      return afterTriggerInput;
    }

    const menuItem = findUploadMenuItem();
    if (menuItem) {
      await modules.clickElement(menuItem, antiBotConfig);
      await modules.waitForDelay([220, 420], antiBotConfig);
    }

    return findFileInput();
  }

  async function downloadAttachmentFile(attachment) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = globalThis.CONFIG?.ATTACHMENTS?.DOWNLOAD_TIMEOUT_MS || 30000;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetch(attachment.downloadUrl, {
        signal: controller?.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      return new File([blob], attachment.name, {
        type: blob.type || attachment.mimeType || "application/octet-stream",
        lastModified: Date.now()
      });
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  function assignFilesToInput(input, files) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") {
      throw new Error("No file input is available for attachments.");
    }
    if (typeof DataTransfer !== "function") {
      throw new Error("This browser does not expose DataTransfer for automated file uploads.");
    }

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    if ((input.files?.length || 0) !== files.length) {
      throw new Error("The target site rejected the automated file assignment.");
    }
  }

  async function waitForAttachmentReady(previousCount, antiBotConfig = {}) {
    const selectors = getAttachmentSelectors();
    if (!selectors.attachmentReadyIndicator) {
      await modules.waitForDelay(
        globalThis.CONFIG?.ATTACHMENTS?.POST_ASSIGN_WAIT_MS || [2200, 3200],
        antiBotConfig
      );
      return true;
    }

    const timeoutMs = globalThis.CONFIG?.ATTACHMENTS?.READY_TIMEOUT_MS || 20000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (countReadyIndicators() > previousCount) {
        return true;
      }
      await modules.waitForDelay([220, 360], antiBotConfig);
    }

    throw new Error("The uploaded file did not reach the ready state before timeout.");
  }

  async function attachProjectFiles(attachments, antiBotConfig = {}) {
    const normalizedAttachments = Array.isArray(attachments)
      ? attachments.map(normalizeAttachmentDescriptor).filter(Boolean)
      : [];
    if (normalizedAttachments.length === 0) {
      return true;
    }

    if (getSiteProfile().features?.supportsAttachments !== true) {
      throw new Error("The current site profile does not support automated attachments.");
    }

    let attachmentIndex = 0;
    while (attachmentIndex < normalizedAttachments.length) {
      const readyCountBefore = countReadyIndicators();
      const input = await ensureUploadInput(antiBotConfig);
      if (!input) {
        throw new Error("Could not locate the upload input for the current site profile.");
      }

      const currentBatch = input.multiple
        ? normalizedAttachments.slice(attachmentIndex)
        : [normalizedAttachments[attachmentIndex]];
      const files = [];
      for (const attachment of currentBatch) {
        files.push(await downloadAttachmentFile(attachment));
      }

      assignFilesToInput(input, files);
      await waitForAttachmentReady(readyCountBefore, antiBotConfig);
      attachmentIndex += currentBatch.length;
      await modules.waitForDelay([180, 320], antiBotConfig);
    }

    return true;
  }

  Object.assign(modules, {
    attachProjectFiles
  });
})();