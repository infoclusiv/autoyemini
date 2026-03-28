export class SettingsPanel {
  constructor({
    useTempChatCheckbox,
    useWebSearchCheckbox,
    keepSameChatCheckbox,
    humanTypingCheckbox,
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
    this.humanTypingCheckbox = humanTypingCheckbox;
    this.randomDelaysCheckbox = randomDelaysCheckbox;
    this.biologicalPausesCheckbox = biologicalPausesCheckbox;
    this.biologicalPauseFields = biologicalPauseFields;
    this.fatigueCountInput = fatigueCountInput;
    this.fatigueMinMinutesInput = fatigueMinMinutesInput;
    this.fatigueMaxMinutesInput = fatigueMaxMinutesInput;
  }

  setValues({
    useTempChat,
    useWebSearch,
    keepSameChat,
    humanTyping,
    randomDelays,
    biologicalPauses,
    fatigueCount,
    fatigueMinMinutes,
    fatigueMaxMinutes
  }) {
    this.useTempChatCheckbox.checked = useTempChat;
    this.useWebSearchCheckbox.checked = useWebSearch;
    this.keepSameChatCheckbox.checked = keepSameChat || false;
    this.humanTypingCheckbox.checked = humanTyping !== false;
    this.randomDelaysCheckbox.checked = randomDelays !== false;
    this.biologicalPausesCheckbox.checked = biologicalPauses === true;
    this.fatigueCountInput.value = String(Math.max(1, Number(fatigueCount) || 10));
    this.fatigueMinMinutesInput.value = String(Math.max(0.5, Number(fatigueMinMinutes) || 0.5));
    this.fatigueMaxMinutesInput.value = String(
      Math.max(Number(this.fatigueMinMinutesInput.value), Number(fatigueMaxMinutes) || 1)
    );
    this.setBiologicalPauseVisibility(this.biologicalPausesCheckbox.checked);
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

    return {
      useTempChat: this.useTempChatCheckbox.checked,
      useWebSearch: this.useWebSearchCheckbox.checked,
      keepSameChat: this.keepSameChatCheckbox.checked,
      humanTyping: this.humanTypingCheckbox.checked,
      randomDelays: this.randomDelaysCheckbox.checked,
      biologicalPauses: this.biologicalPausesCheckbox.checked,
      typingSpeed: [...(globalThis.CONFIG?.ANTI_BOT?.TYPING_SPEED_MS || [30, 100])],
      fatigueCount,
      fatigueMinMinutes,
      fatigueMaxMinutes
    };
  }
}