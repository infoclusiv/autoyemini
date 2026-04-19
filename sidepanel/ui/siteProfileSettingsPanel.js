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

export class SiteProfileSettingsPanel {
  constructor({
    siteProfileBaseUrlInput,
    siteProfileUrlPatternInput,
    siteProfileInputSelectorInput,
    siteProfileSendButtonSelectorInput,
    siteProfileAssistantMessageSelectorInput,
    siteProfileAnswerRootSelectorInput,
    siteProfileSourceLinksSelectorInput,
    siteProfileCaptureModeSelect,
    siteProfileRequestUrlPatternsInput
  }) {
    this.baseUrlInput = siteProfileBaseUrlInput;
    this.urlPatternInput = siteProfileUrlPatternInput;
    this.inputSelectorInput = siteProfileInputSelectorInput;
    this.sendButtonSelectorInput = siteProfileSendButtonSelectorInput;
    this.assistantMessageSelectorInput = siteProfileAssistantMessageSelectorInput;
    this.answerRootSelectorInput = siteProfileAnswerRootSelectorInput;
    this.sourceLinksSelectorInput = siteProfileSourceLinksSelectorInput;
    this.captureModeSelect = siteProfileCaptureModeSelect;
    this.requestUrlPatternsInput = siteProfileRequestUrlPatternsInput;

    this.fields = [
      this.baseUrlInput,
      this.urlPatternInput,
      this.inputSelectorInput,
      this.sendButtonSelectorInput,
      this.assistantMessageSelectorInput,
      this.answerRootSelectorInput,
      this.sourceLinksSelectorInput,
      this.captureModeSelect,
      this.requestUrlPatternsInput
    ].filter(Boolean);
  }

  setValues(siteProfile) {
    const normalized = normalizeSiteProfile(siteProfile);

    this.baseUrlInput.value = normalized.baseUrl || "";
    this.urlPatternInput.value = normalized.urlPattern || "";
    this.inputSelectorInput.value = normalized.selectors?.input || "";
    this.sendButtonSelectorInput.value = normalized.selectors?.sendButton || "";
    this.assistantMessageSelectorInput.value = normalized.selectors?.assistantMessage || "";
    this.answerRootSelectorInput.value = normalized.selectors?.answerRoot || "";
    this.sourceLinksSelectorInput.value = normalized.selectors?.sourceLinks || "";
    this.captureModeSelect.value = normalized.capture?.mode || "dom_only";
    this.requestUrlPatternsInput.value = joinLines(normalized.capture?.requestUrlPatterns);
  }

  setValuesFromTemplate(siteProfile) {
    this.setValues(siteProfile);
  }

  getValues() {
    return normalizeSiteProfile({
      baseUrl: this.baseUrlInput.value,
      urlPattern: this.urlPatternInput.value,
      selectors: {
        input: this.inputSelectorInput.value,
        sendButton: this.sendButtonSelectorInput.value,
        assistantMessage: this.assistantMessageSelectorInput.value,
        answerRoot: this.answerRootSelectorInput.value,
        sourceLinks: this.sourceLinksSelectorInput.value
      },
      capture: {
        mode: this.captureModeSelect.value,
        requestUrlPatterns: splitLines(this.requestUrlPatternsInput.value)
      }
    });
  }

  bindEvents(onChange) {
    if (typeof onChange !== "function") {
      return;
    }

    this.fields.forEach((field) => {
      field.addEventListener("change", () => {
        onChange(this.getValues());
      });
    });
  }
}