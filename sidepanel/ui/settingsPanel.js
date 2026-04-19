import { GeneralSettingsPanel } from "./generalSettingsPanel.js";
import { SiteProfileSettingsPanel } from "./siteProfileSettingsPanel.js";

export class SettingsPanel {
  constructor(elements) {
    this.general = new GeneralSettingsPanel({
      useTempChatCheckbox: elements.useTempChatCheckbox,
      useWebSearchCheckbox: elements.useWebSearchCheckbox,
      keepSameChatCheckbox: elements.keepSameChatCheckbox
    });

    this.siteProfile = new SiteProfileSettingsPanel({
      siteProfileBaseUrlInput: elements.siteProfileBaseUrlInput,
      siteProfileUrlPatternInput: elements.siteProfileUrlPatternInput,
      siteProfileInputSelectorInput: elements.siteProfileInputSelectorInput,
      siteProfileSendButtonSelectorInput: elements.siteProfileSendButtonSelectorInput,
      siteProfileAssistantMessageSelectorInput: elements.siteProfileAssistantMessageSelectorInput,
      siteProfileAnswerRootSelectorInput: elements.siteProfileAnswerRootSelectorInput,
      siteProfileSourceLinksSelectorInput: elements.siteProfileSourceLinksSelectorInput,
      siteProfileCaptureModeSelect: elements.siteProfileCaptureModeSelect,
      siteProfileRequestUrlPatternsInput: elements.siteProfileRequestUrlPatternsInput
    });
  }

  setValues(settings) {
    if (!settings) return;
    this.general.setValues(settings);
    this.siteProfile.setValues(settings.siteProfile || settings);
  }

  setValuesFromTemplate(settings) {
    this.general.setValuesFromTemplate(settings || {});
  }

  getValues() {
    return {
      ...this.general.getValues(),
      siteProfile: this.siteProfile.getValues()
    };
  }

  bindSiteProfileEvents(onChange) {
    this.siteProfile.bindEvents(onChange);
  }
}