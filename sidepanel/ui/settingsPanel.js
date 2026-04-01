import { GeneralSettingsPanel } from "./generalSettingsPanel.js";

export class SettingsPanel {
  constructor(elements) {
    this.general = new GeneralSettingsPanel({
      useTempChatCheckbox: elements.useTempChatCheckbox,
      useWebSearchCheckbox: elements.useWebSearchCheckbox,
      keepSameChatCheckbox: elements.keepSameChatCheckbox
    });
  }

  setValues(settings) {
    if (!settings) return;
    this.general.setValues(settings);
  }

  setValuesFromTemplate(settings) {
    this.general.setValuesFromTemplate(settings || {});
  }

  getValues() {
    return this.general.getValues();
  }
}