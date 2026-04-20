import { saveSiteProfile } from "../services/storageService.js";
import { SiteProfileSettingsPanel } from "../ui/siteProfileSettingsPanel.js";

const storageKeys = globalThis.CONFIG?.STORAGE_KEYS || {
  SITE_PROFILE: "siteProfile"
};

const loadSiteProfile =
  globalThis.CONFIG?.loadStoredSiteProfile ||
  (async () => globalThis.CONFIG?.getStoredSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {});

let panel;
let saveButton;
let reloadButton;
let dirtyBadge;
let statusElement;
let isDirty = false;
let isSaving = false;

function getElements() {
  return {
    form: document.getElementById("siteProfileForm"),
    saveButton: document.getElementById("siteProfileSaveBtn"),
    reloadButton: document.getElementById("siteProfileReloadBtn"),
    dirtyBadge: document.getElementById("siteProfileDirtyBadge"),
    statusElement: document.getElementById("siteProfileStatus"),
    siteProfileSiteKeyValue: document.getElementById("siteProfileSiteKeyValue"),
    siteProfileDisplayNameValue: document.getElementById("siteProfileDisplayNameValue"),
    siteProfileBaseUrlInput: document.getElementById("siteProfileBaseUrlInput"),
    siteProfileUrlPatternInput: document.getElementById("siteProfileUrlPatternInput"),
    siteProfileTempChatParamInput: document.getElementById("siteProfileTempChatParamInput"),
    siteProfileInputSelectorInput: document.getElementById("siteProfileInputSelectorInput"),
    siteProfileSendButtonSelectorInput: document.getElementById("siteProfileSendButtonSelectorInput"),
    siteProfileAssistantMessageSelectorInput: document.getElementById("siteProfileAssistantMessageSelectorInput"),
    siteProfileAnswerRootSelectorInput: document.getElementById("siteProfileAnswerRootSelectorInput"),
    siteProfileSourceLinksSelectorInput: document.getElementById("siteProfileSourceLinksSelectorInput"),
    siteProfileSupportsAttachmentsCheckbox: document.getElementById("siteProfileSupportsAttachmentsCheckbox"),
    siteProfileAttachmentTriggerSelectorInput: document.getElementById("siteProfileAttachmentTriggerSelectorInput"),
    siteProfileAttachmentUploadMenuItemSelectorInput: document.getElementById("siteProfileAttachmentUploadMenuItemSelectorInput"),
    siteProfileFileInputSelectorInput: document.getElementById("siteProfileFileInputSelectorInput"),
    siteProfileAttachmentReadyIndicatorSelectorInput: document.getElementById("siteProfileAttachmentReadyIndicatorSelectorInput"),
    siteProfileCaptureModeSelect: document.getElementById("siteProfileCaptureModeSelect"),
    siteProfileRequestUrlPatternsInput: document.getElementById("siteProfileRequestUrlPatternsInput"),
    siteProfileJsonPathsInput: document.getElementById("siteProfileJsonPathsInput"),
    siteProfileDomMaxAttemptsInput: document.getElementById("siteProfileDomMaxAttemptsInput"),
    siteProfileDomPollIntervalMsInput: document.getElementById("siteProfileDomPollIntervalMsInput"),
    siteProfileSseReadyDelayMsInput: document.getElementById("siteProfileSseReadyDelayMsInput"),
    siteProfileSupportsWebSearchCheckbox: document.getElementById("siteProfileSupportsWebSearchCheckbox"),
    siteProfileSourceExclusionsInput: document.getElementById("siteProfileSourceExclusionsInput")
  };
}

function setStatus(message, tone = "neutral") {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

function updateActionState() {
  saveButton.disabled = isSaving || !isDirty;
  reloadButton.disabled = isSaving;
}

function setDirty(nextDirty) {
  isDirty = Boolean(nextDirty);
  dirtyBadge.dataset.state = isDirty ? "dirty" : "clean";
  dirtyBadge.textContent = isDirty ? "Unsaved changes" : "All changes saved";
  updateActionState();
}

async function loadIntoForm(successMessage, tone = "success") {
  const siteProfile = await loadSiteProfile();
  panel.setValues(siteProfile);
  setDirty(false);
  setStatus(successMessage, tone);
}

async function handleSave() {
  if (isSaving) {
    return;
  }

  try {
    isSaving = true;
    updateActionState();
    setStatus("Saving site profile to extension storage...", "neutral");

    const nextProfile = panel.getValues();
    const result = await saveSiteProfile(nextProfile);
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    const message = warnings.length > 0
      ? `Site profile saved. ${warnings[0]}`
      : "Site profile saved. These values will remain after closing or reloading the extension.";
    await loadIntoForm(message, warnings.length > 0 ? "warning" : "success");
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, "error");
  } finally {
    isSaving = false;
    updateActionState();
  }
}

async function handleReload() {
  if (isSaving) {
    return;
  }

  try {
    setStatus("Reloading the saved site profile...", "neutral");
    await loadIntoForm("Reloaded the site profile from extension storage.");
  } catch (error) {
    setStatus(`Reload failed: ${error.message}`, "error");
  }
}

function handleFormChange() {
  setDirty(true);
  setStatus("Unsaved changes detected. Save to persist them across reloads.", "warning");
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, storageKeys.SITE_PROFILE)) {
    return;
  }

  panel.setValues(changes[storageKeys.SITE_PROFILE].newValue);
  setDirty(false);
  setStatus("Site profile refreshed from extension storage.", "success");
}

async function init() {
  const elements = getElements();
  saveButton = elements.saveButton;
  reloadButton = elements.reloadButton;
  dirtyBadge = elements.dirtyBadge;
  statusElement = elements.statusElement;

  panel = new SiteProfileSettingsPanel(elements);
  panel.bindEvents(() => {
    handleFormChange();
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSave();
  });
  saveButton.addEventListener("click", () => {
    void handleSave();
  });
  reloadButton.addEventListener("click", () => {
    void handleReload();
  });

  chrome.storage.onChanged.addListener(handleStorageChange);

  try {
    await loadIntoForm("Loaded saved site profile.");
  } catch (error) {
    setStatus(`Failed to load site profile: ${error.message}`, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
