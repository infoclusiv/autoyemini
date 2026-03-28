export class ExtractionSettingsPanel {
  constructor({
    useExtractionCheckbox,
    extractionFields,
    extractionRegexInput,
    injectionPlaceholderInput
  }) {
    this.useExtractionCheckbox = useExtractionCheckbox;
    this.extractionFields = extractionFields;
    this.extractionRegexInput = extractionRegexInput;
    this.injectionPlaceholderInput = injectionPlaceholderInput;
  }

  setValues(settings) {
    if (!settings) {
      return;
    }

    if (settings.useExtraction !== undefined) {
      this.useExtractionCheckbox.checked = settings.useExtraction;
    }
    if (settings.extractionRegex !== undefined) {
      this.extractionRegexInput.value = settings.extractionRegex;
    }
    if (settings.injectionPlaceholder !== undefined) {
      this.injectionPlaceholderInput.value = settings.injectionPlaceholder;
    }

    this.setExtractionVisibility(this.useExtractionCheckbox.checked);
  }

  setValuesFromTemplate(settings) {
    const safeSettings = settings || {};

    if (safeSettings.useExtraction !== undefined) {
      this.useExtractionCheckbox.checked = safeSettings.useExtraction;
    }
    if (safeSettings.extractionRegex !== undefined) {
      this.extractionRegexInput.value = safeSettings.extractionRegex;
    }
    if (safeSettings.injectionPlaceholder !== undefined) {
      this.injectionPlaceholderInput.value = safeSettings.injectionPlaceholder;
    }

    this.setExtractionVisibility(this.useExtractionCheckbox.checked);
  }

  setExtractionVisibility(isVisible) {
    this.extractionFields.classList.toggle("is-hidden", !isVisible);
  }

  getValues() {
    const extractionRegex =
      this.extractionRegexInput.value.trim() ||
      globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX ||
      "<extract>(.*?)</extract>";
    const injectionPlaceholder =
      this.injectionPlaceholderInput.value.trim() ||
      globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER ||
      "{{extract}}";

    this.extractionRegexInput.value = extractionRegex;
    this.injectionPlaceholderInput.value = injectionPlaceholder;

    return {
      useExtraction: this.useExtractionCheckbox.checked,
      extractionRegex,
      injectionPlaceholder
    };
  }
}
