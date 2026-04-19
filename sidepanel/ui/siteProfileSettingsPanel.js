const normalizeSiteProfile = globalThis.CONFIG?.normalizeSiteProfile || ((value) => value || {});

function joinLines(values) {
  if (!Array.isArray(values)) {
    return "";
  }

  return values.join("\n");
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function setInputValue(field, value) {
  if (!field) {
    return;
  }

  if (field.type === "checkbox") {
    field.checked = Boolean(value);
    return;
  }

  field.value = value ?? "";
}

export class SiteProfileSettingsPanel {
  constructor({
    siteProfileSiteKeyValue,
    siteProfileDisplayNameValue,
    siteProfileBaseUrlInput,
    siteProfileUrlPatternInput,
    siteProfileTempChatParamInput,
    siteProfileInputSelectorInput,
    siteProfileSendButtonSelectorInput,
    siteProfileAssistantMessageSelectorInput,
    siteProfileAnswerRootSelectorInput,
    siteProfileSourceLinksSelectorInput,
    siteProfileCaptureModeSelect,
    siteProfileRequestUrlPatternsInput,
    siteProfileJsonPathsInput,
    siteProfileDomMaxAttemptsInput,
    siteProfileDomPollIntervalMsInput,
    siteProfileSseReadyDelayMsInput,
    siteProfileSupportsWebSearchCheckbox,
    siteProfileSourceExclusionsInput
  }) {
    this.siteKeyValue = siteProfileSiteKeyValue;
    this.displayNameValue = siteProfileDisplayNameValue;
    this.baseUrlInput = siteProfileBaseUrlInput;
    this.urlPatternInput = siteProfileUrlPatternInput;
    this.tempChatParamInput = siteProfileTempChatParamInput;
    this.inputSelectorInput = siteProfileInputSelectorInput;
    this.sendButtonSelectorInput = siteProfileSendButtonSelectorInput;
    this.assistantMessageSelectorInput = siteProfileAssistantMessageSelectorInput;
    this.answerRootSelectorInput = siteProfileAnswerRootSelectorInput;
    this.sourceLinksSelectorInput = siteProfileSourceLinksSelectorInput;
    this.captureModeSelect = siteProfileCaptureModeSelect;
    this.requestUrlPatternsInput = siteProfileRequestUrlPatternsInput;
    this.jsonPathsInput = siteProfileJsonPathsInput;
    this.domMaxAttemptsInput = siteProfileDomMaxAttemptsInput;
    this.domPollIntervalMsInput = siteProfileDomPollIntervalMsInput;
    this.sseReadyDelayMsInput = siteProfileSseReadyDelayMsInput;
    this.supportsWebSearchCheckbox = siteProfileSupportsWebSearchCheckbox;
    this.sourceExclusionsInput = siteProfileSourceExclusionsInput;

    this.currentProfile = normalizeSiteProfile(
      globalThis.CONFIG?.getSiteProfile?.() || globalThis.CONFIG?.DEFAULT_SITE_PROFILE || {}
    );

    this.fields = [
      this.baseUrlInput,
      this.urlPatternInput,
      this.tempChatParamInput,
      this.inputSelectorInput,
      this.sendButtonSelectorInput,
      this.assistantMessageSelectorInput,
      this.answerRootSelectorInput,
      this.sourceLinksSelectorInput,
      this.captureModeSelect,
      this.requestUrlPatternsInput,
      this.jsonPathsInput,
      this.domMaxAttemptsInput,
      this.domPollIntervalMsInput,
      this.sseReadyDelayMsInput,
      this.supportsWebSearchCheckbox,
      this.sourceExclusionsInput
    ].filter(Boolean);
  }

  setValues(siteProfile) {
    const normalized = normalizeSiteProfile(siteProfile);
    this.currentProfile = normalized;

    if (this.siteKeyValue) {
      this.siteKeyValue.textContent = normalized.siteKey || "";
    }
    if (this.displayNameValue) {
      this.displayNameValue.textContent = normalized.displayName || "";
    }

    setInputValue(this.baseUrlInput, normalized.baseUrl);
    setInputValue(this.urlPatternInput, normalized.urlPattern);
    setInputValue(this.tempChatParamInput, normalized.tempChatParam);
    setInputValue(this.inputSelectorInput, normalized.selectors?.input);
    setInputValue(this.sendButtonSelectorInput, normalized.selectors?.sendButton);
    setInputValue(this.assistantMessageSelectorInput, normalized.selectors?.assistantMessage);
    setInputValue(this.answerRootSelectorInput, normalized.selectors?.answerRoot);
    setInputValue(this.sourceLinksSelectorInput, normalized.selectors?.sourceLinks);
    setInputValue(this.captureModeSelect, normalized.capture?.mode || "dom_only");
    setInputValue(this.requestUrlPatternsInput, joinLines(normalized.capture?.requestUrlPatterns));
    setInputValue(this.jsonPathsInput, joinLines(normalized.capture?.jsonPaths));
    setInputValue(this.domMaxAttemptsInput, normalized.capture?.domMaxAttempts);
    setInputValue(this.domPollIntervalMsInput, normalized.capture?.domPollIntervalMs);
    setInputValue(this.sseReadyDelayMsInput, normalized.capture?.sseReadyDelayMs);
    setInputValue(this.supportsWebSearchCheckbox, normalized.features?.supportsWebSearch);
    setInputValue(this.sourceExclusionsInput, joinLines(normalized.sourceExclusions));
  }

  setValuesFromTemplate(siteProfile) {
    this.setValues(siteProfile);
  }

  getValues() {
    const nextProfile = {
      ...this.currentProfile,
      baseUrl: this.baseUrlInput ? this.baseUrlInput.value : this.currentProfile.baseUrl,
      urlPattern: this.urlPatternInput ? this.urlPatternInput.value : this.currentProfile.urlPattern,
      tempChatParam: this.tempChatParamInput
        ? this.tempChatParamInput.value
        : this.currentProfile.tempChatParam,
      selectors: {
        ...(this.currentProfile.selectors || {}),
        input: this.inputSelectorInput
          ? this.inputSelectorInput.value
          : this.currentProfile.selectors?.input,
        sendButton: this.sendButtonSelectorInput
          ? this.sendButtonSelectorInput.value
          : this.currentProfile.selectors?.sendButton,
        assistantMessage: this.assistantMessageSelectorInput
          ? this.assistantMessageSelectorInput.value
          : this.currentProfile.selectors?.assistantMessage,
        answerRoot: this.answerRootSelectorInput
          ? this.answerRootSelectorInput.value
          : this.currentProfile.selectors?.answerRoot,
        sourceLinks: this.sourceLinksSelectorInput
          ? this.sourceLinksSelectorInput.value
          : this.currentProfile.selectors?.sourceLinks
      },
      capture: {
        ...(this.currentProfile.capture || {}),
        mode: this.captureModeSelect
          ? this.captureModeSelect.value
          : this.currentProfile.capture?.mode,
        requestUrlPatterns: this.requestUrlPatternsInput
          ? splitLines(this.requestUrlPatternsInput.value)
          : this.currentProfile.capture?.requestUrlPatterns,
        jsonPaths: this.jsonPathsInput
          ? splitLines(this.jsonPathsInput.value)
          : this.currentProfile.capture?.jsonPaths,
        domMaxAttempts: this.domMaxAttemptsInput
          ? this.domMaxAttemptsInput.value
          : this.currentProfile.capture?.domMaxAttempts,
        domPollIntervalMs: this.domPollIntervalMsInput
          ? this.domPollIntervalMsInput.value
          : this.currentProfile.capture?.domPollIntervalMs,
        sseReadyDelayMs: this.sseReadyDelayMsInput
          ? this.sseReadyDelayMsInput.value
          : this.currentProfile.capture?.sseReadyDelayMs
      },
      features: {
        ...(this.currentProfile.features || {}),
        supportsWebSearch: this.supportsWebSearchCheckbox
          ? this.supportsWebSearchCheckbox.checked
          : this.currentProfile.features?.supportsWebSearch
      },
      sourceExclusions: this.sourceExclusionsInput
        ? splitLines(this.sourceExclusionsInput.value)
        : this.currentProfile.sourceExclusions
    };

    this.currentProfile = normalizeSiteProfile(nextProfile);
    return this.currentProfile;
  }

  bindEvents(onChange) {
    if (typeof onChange !== "function") {
      return;
    }

    this.fields.forEach((field) => {
      const eventName =
        field.tagName === "SELECT" || field.type === "checkbox" ? "change" : "input";

      field.addEventListener(eventName, () => {
        onChange(this.getValues());
      });
    });
  }
}