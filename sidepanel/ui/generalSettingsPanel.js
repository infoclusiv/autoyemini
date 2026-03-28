export class GeneralSettingsPanel {
  constructor({ useTempChatCheckbox, useWebSearchCheckbox, keepSameChatCheckbox }) {
    this.useTempChatCheckbox = useTempChatCheckbox;
    this.useWebSearchCheckbox = useWebSearchCheckbox;
    this.keepSameChatCheckbox = keepSameChatCheckbox;
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
  }

  getValues() {
    return {
      useTempChat: this.useTempChatCheckbox.checked,
      useWebSearch: this.useWebSearchCheckbox.checked,
      keepSameChat: this.keepSameChatCheckbox.checked
    };
  }
}
