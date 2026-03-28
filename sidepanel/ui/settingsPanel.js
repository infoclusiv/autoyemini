export class SettingsPanel {
  constructor({ useTempChatCheckbox, useWebSearchCheckbox }) {
    this.useTempChatCheckbox = useTempChatCheckbox;
    this.useWebSearchCheckbox = useWebSearchCheckbox;
  }

  setValues({ useTempChat, useWebSearch }) {
    this.useTempChatCheckbox.checked = useTempChat;
    this.useWebSearchCheckbox.checked = useWebSearch;
  }

  getValues() {
    return {
      useTempChat: this.useTempChatCheckbox.checked,
      useWebSearch: this.useWebSearchCheckbox.checked
    };
  }
}