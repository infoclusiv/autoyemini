export class SettingsPanel {
  constructor({ useTempChatCheckbox, useWebSearchCheckbox, keepSameChatCheckbox }) {
    this.useTempChatCheckbox = useTempChatCheckbox;
    this.useWebSearchCheckbox = useWebSearchCheckbox;
    this.keepSameChatCheckbox = keepSameChatCheckbox;
  }

  setValues({ useTempChat, useWebSearch, keepSameChat }) {
    this.useTempChatCheckbox.checked = useTempChat;
    this.useWebSearchCheckbox.checked = useWebSearch;
    this.keepSameChatCheckbox.checked = keepSameChat || false;
  }

  getValues() {
    return {
      useTempChat: this.useTempChatCheckbox.checked,
      useWebSearch: this.useWebSearchCheckbox.checked,
      keepSameChat: this.keepSameChatCheckbox.checked
    };
  }
}