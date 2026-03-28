export class SettingsPanel {
  constructor({
    useTempChatCheckbox,
    useWebSearchCheckbox,
    keepSameChatCheckbox,
    useExtractionCheckbox,
    extractionFields,
    extractionRegexInput,
    injectionPlaceholderInput,
    humanTypingCheckbox,
    humanTypingFields,
    typingSpeedMinInput,
    typingSpeedMaxInput,
    randomDelaysCheckbox,
    biologicalPausesCheckbox,
    biologicalPauseFields,
    fatigueCountInput,
    fatigueMinMinutesInput,
    fatigueMaxMinutesInput
  }) {
    this.useTempChatCheckbox = useTempChatCheckbox;
    this.useWebSearchCheckbox = useWebSearchCheckbox;
    this.keepSameChatCheckbox = keepSameChatCheckbox;
    this.useExtractionCheckbox = useExtractionCheckbox;
    this.extractionFields = extractionFields;
    this.extractionRegexInput = extractionRegexInput;
    this.injectionPlaceholderInput = injectionPlaceholderInput;
    this.humanTypingCheckbox = humanTypingCheckbox;
    this.humanTypingFields = humanTypingFields;
    this.typingSpeedMinInput = typingSpeedMinInput;
    this.typingSpeedMaxInput = typingSpeedMaxInput;
    this.randomDelaysCheckbox = randomDelaysCheckbox;
    this.biologicalPausesCheckbox = biologicalPausesCheckbox;
    this.biologicalPauseFields = biologicalPauseFields;
    this.fatigueCountInput = fatigueCountInput;
    this.fatigueMinMinutesInput = fatigueMinMinutesInput;
    this.fatigueMaxMinutesInput = fatigueMaxMinutesInput;
  }

  setValues(settings) {
    if (!settings) {
      return;
    }

    if (settings.useTempChat !== undefined) {
      this.useTempChatCheckbox.checked = settings.useTempChat;
    }
    if (settings.useWebSearch !== undefined) {
      this.useWebSearchCheckbox.checked = settings.useWebSearch;
    }
    if (settings.keepSameChat !== undefined) {
      this.keepSameChatCheckbox.checked = settings.keepSameChat;
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

    if (settings.humanTyping !== undefined) {
      this.humanTypingCheckbox.checked = settings.humanTyping;
    }
    if (settings.randomDelays !== undefined) {
      this.randomDelaysCheckbox.checked = settings.randomDelays;
    }
    if (settings.biologicalPauses !== undefined) {
      this.biologicalPausesCheckbox.checked = settings.biologicalPauses;
    }
    if (settings.fatigueCount !== undefined) {
      this.fatigueCountInput.value = String(settings.fatigueCount);
    }
    if (settings.fatigueMinMinutes !== undefined) {
      this.fatigueMinMinutesInput.value = String(settings.fatigueMinMinutes);
    }
    if (settings.fatigueMaxMinutes !== undefined) {
      this.fatigueMaxMinutesInput.value = String(settings.fatigueMaxMinutes);
    }

    if (settings.typingSpeed !== undefined && Array.isArray(settings.typingSpeed)) {
      this.typingSpeedMinInput.value = String(settings.typingSpeed[0] ?? 30);
      this.typingSpeedMaxInput.value = String(settings.typingSpeed[1] ?? 100);
    }

    this.setExtractionVisibility(this.useExtractionCheckbox.checked);
    this.setBiologicalPauseVisibility(this.biologicalPausesCheckbox.checked);
    this.setHumanTypingVisibility(this.humanTypingCheckbox.checked);
  }

  setValuesFromTemplate(settings) {
    const safeSettings = settings || {};

    if (safeSettings.useTempChat !== undefined) {
      this.useTempChatCheckbox.checked = safeSettings.useTempChat;
    }
    if (safeSettings.useWebSearch !== undefined) {
      this.useWebSearchCheckbox.checked = safeSettings.useWebSearch;
    }
    if (safeSettings.keepSameChat !== undefined) {
      this.keepSameChatCheckbox.checked = safeSettings.keepSameChat;
    }

    if (safeSettings.useExtraction !== undefined) {
      this.useExtractionCheckbox.checked = safeSettings.useExtraction;
    }
    if (safeSettings.extractionRegex !== undefined) {
      this.extractionRegexInput.value = safeSettings.extractionRegex;
    }
    if (safeSettings.injectionPlaceholder !== undefined) {
      this.injectionPlaceholderInput.value = safeSettings.injectionPlaceholder;
    }

    this.humanTypingCheckbox.checked = safeSettings.humanTyping === true;
    this.randomDelaysCheckbox.checked = safeSettings.randomDelays === true;
    this.biologicalPausesCheckbox.checked = safeSettings.biologicalPauses === true;

    this.fatigueCountInput.value = String(safeSettings.fatigueCount ?? 10);
    this.fatigueMinMinutesInput.value = String(safeSettings.fatigueMinMinutes ?? 0.5);
    this.fatigueMaxMinutesInput.value = String(safeSettings.fatigueMaxMinutes ?? 1);

    if (safeSettings.typingSpeed !== undefined && Array.isArray(safeSettings.typingSpeed)) {
      this.typingSpeedMinInput.value = String(safeSettings.typingSpeed[0] ?? 30);
      this.typingSpeedMaxInput.value = String(safeSettings.typingSpeed[1] ?? 100);
    } else {
      this.typingSpeedMinInput.value = "30";
      this.typingSpeedMaxInput.value = "100";
    }

    this.setExtractionVisibility(this.useExtractionCheckbox.checked);
    this.setBiologicalPauseVisibility(this.biologicalPausesCheckbox.checked);
    this.setHumanTypingVisibility(this.humanTypingCheckbox.checked);
  }

  setExtractionVisibility(isVisible) {
    this.extractionFields.classList.toggle("is-hidden", !isVisible);
  }

  setBiologicalPauseVisibility(isVisible) {
    this.biologicalPauseFields.classList.toggle("is-hidden", !isVisible);
  }

  setHumanTypingVisibility(isVisible) {
    if (this.humanTypingFields) {
      this.humanTypingFields.classList.toggle("is-hidden", !isVisible);
    }
  }

  getValues() {
    const fatigueCount = Math.max(1, parseInt(this.fatigueCountInput.value || "10", 10) || 10);
    const fatigueMinMinutes = Math.max(0.5, Number(this.fatigueMinMinutesInput.value) || 0.5);
    const fatigueMaxMinutes = Math.max(
      fatigueMinMinutes,
      Number(this.fatigueMaxMinutesInput.value) || fatigueMinMinutes
    );

    this.fatigueCountInput.value = String(fatigueCount);
    this.fatigueMinMinutesInput.value = String(fatigueMinMinutes);
    this.fatigueMaxMinutesInput.value = String(fatigueMaxMinutes);

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

    const typingSpeedMin = Math.max(0, parseInt(this.typingSpeedMinInput.value || "30", 10) || 30);
    const typingSpeedMax = Math.max(typingSpeedMin, parseInt(this.typingSpeedMaxInput.value || "100", 10) || 100);

    this.typingSpeedMinInput.value = String(typingSpeedMin);
    this.typingSpeedMaxInput.value = String(typingSpeedMax);

    return {
      useTempChat: this.useTempChatCheckbox.checked,
      useWebSearch: this.useWebSearchCheckbox.checked,
      keepSameChat: this.keepSameChatCheckbox.checked,
      useExtraction: this.useExtractionCheckbox.checked,
      extractionRegex,
      injectionPlaceholder,
      humanTyping: this.humanTypingCheckbox.checked,
      randomDelays: this.randomDelaysCheckbox.checked,
      biologicalPauses: this.biologicalPausesCheckbox.checked,
      typingSpeed: [typingSpeedMin, typingSpeedMax],
      fatigueCount,
      fatigueMinMinutes,
      fatigueMaxMinutes
    };
  }
}