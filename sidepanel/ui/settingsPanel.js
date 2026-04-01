import { GeneralSettingsPanel } from "./generalSettingsPanel.js";
import { AntiBotSettingsPanel } from "./antiBotSettingsPanel.js";

export class SettingsPanel {
  constructor(elements) {
    this.general = new GeneralSettingsPanel({
      useTempChatCheckbox: elements.useTempChatCheckbox,
      useWebSearchCheckbox: elements.useWebSearchCheckbox,
      keepSameChatCheckbox: elements.keepSameChatCheckbox
    });

    this.antiBot = new AntiBotSettingsPanel({
      humanTypingCheckbox: elements.humanTypingCheckbox,
      humanTypingFields: elements.humanTypingFields,
      typingSpeedMinInput: elements.typingSpeedMinInput,
      typingSpeedMaxInput: elements.typingSpeedMaxInput,
      randomDelaysCheckbox: elements.randomDelaysCheckbox,
      biologicalPausesCheckbox: elements.biologicalPausesCheckbox,
      biologicalPauseFields: elements.biologicalPauseFields,
      fatigueCountInput: elements.fatigueCountInput,
      fatigueMinMinutesInput: elements.fatigueMinMinutesInput,
      fatigueMaxMinutesInput: elements.fatigueMaxMinutesInput
    });
  }

  setValues(settings) {
    if (!settings) {
      return;
    }

    this.general.setValues(settings);
    this.antiBot.setValues(settings);
  }

  setValuesFromTemplate(settings) {
    const safeSettings = settings || {};
    this.general.setValuesFromTemplate(safeSettings);
    this.antiBot.setValuesFromTemplate(safeSettings);
  }

  setBiologicalPauseVisibility(isVisible) {
    this.antiBot.setBiologicalPauseVisibility(isVisible);
  }

  setHumanTypingVisibility(isVisible) {
    this.antiBot.setHumanTypingVisibility(isVisible);
  }

  getValues() {
    return {
      ...this.general.getValues(),
      ...this.antiBot.getValues()
    };
  }
}