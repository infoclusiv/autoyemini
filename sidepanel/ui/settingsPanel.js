import { GeneralSettingsPanel } from "./generalSettingsPanel.js";
import { AntiBotSettingsPanel } from "./antiBotSettingsPanel.js";
import { ExtractionSettingsPanel } from "./extractionSettingsPanel.js";

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

    this.extraction = new ExtractionSettingsPanel({
      useExtractionCheckbox: elements.useExtractionCheckbox,
      extractionFields: elements.extractionFields,
      extractionRegexInput: elements.extractionRegexInput,
      injectionPlaceholderInput: elements.injectionPlaceholderInput
    });
  }

  setValues(settings) {
    if (!settings) {
      return;
    }

    this.general.setValues(settings);
    this.antiBot.setValues(settings);
    this.extraction.setValues(settings);
  }

  setValuesFromTemplate(settings) {
    const safeSettings = settings || {};
    this.general.setValuesFromTemplate(safeSettings);
    this.antiBot.setValuesFromTemplate(safeSettings);
    this.extraction.setValuesFromTemplate(safeSettings);
  }

  setExtractionVisibility(isVisible) {
    this.extraction.setExtractionVisibility(isVisible);
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
      ...this.antiBot.getValues(),
      ...this.extraction.getValues()
    };
  }
}