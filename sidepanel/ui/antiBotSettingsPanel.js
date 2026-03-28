export class AntiBotSettingsPanel {
  constructor({
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

    this.setBiologicalPauseVisibility(this.biologicalPausesCheckbox.checked);
    this.setHumanTypingVisibility(this.humanTypingCheckbox.checked);
  }

  setValuesFromTemplate(settings) {
    const safeSettings = settings || {};

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

    this.setBiologicalPauseVisibility(this.biologicalPausesCheckbox.checked);
    this.setHumanTypingVisibility(this.humanTypingCheckbox.checked);
  }

  setHumanTypingVisibility(isVisible) {
    if (this.humanTypingFields) {
      this.humanTypingFields.classList.toggle("is-hidden", !isVisible);
    }
  }

  setBiologicalPauseVisibility(isVisible) {
    this.biologicalPauseFields.classList.toggle("is-hidden", !isVisible);
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

    const typingSpeedMin = Math.max(0, parseInt(this.typingSpeedMinInput.value || "30", 10) || 30);
    const typingSpeedMax = Math.max(typingSpeedMin, parseInt(this.typingSpeedMaxInput.value || "100", 10) || 100);

    this.typingSpeedMinInput.value = String(typingSpeedMin);
    this.typingSpeedMaxInput.value = String(typingSpeedMax);

    return {
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
