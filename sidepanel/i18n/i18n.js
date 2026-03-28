const BROWSER_LANG = chrome.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh" : "en";

const KEY_MAP = {
  title: "title",
  "input.title": "inputTitle",
  "input.placeholder": "inputPlaceholder",
  "input.addBtn": "inputAddBtn",
  "input.clearBtn": "inputClearBtn",
  "input.singlePrompt": "inputSinglePrompt",
  "template.selectDefault": "templateSelectDefault",
  "template.loadBtn": "templateLoadBtn",
  "template.saveBtn": "templateSaveBtn",
  "template.updateBtn": "templateUpdateBtn",
  "template.renameBtn": "templateRenameBtn",
  "template.deleteBtn": "templateDeleteBtn",
  "template.namePrompt": "templateNamePrompt",
  "template.renamePrompt": "templateRenamePrompt",
  "control.title": "controlTitle",
  "control.startBtn": "controlStartBtn",
  "control.pauseBtn": "controlPauseBtn",
  "control.resumeBtn": "controlResumeBtn",
  "control.stopBtn": "controlStopBtn",
  "control.retryBtn": "controlRetryBtn",
  "control.useTempChat": "controlUseTempChat",
  "control.useTempChatHint": "controlUseTempChatHint",
  "control.useWebSearch": "controlUseWebSearch",
  "control.useWebSearchHint": "controlUseWebSearchHint",
  "control.keepSameChat": "controlKeepSameChat",
  "control.keepSameChatHint": "controlKeepSameChatHint",
  "control.extractionTitle": "controlExtractionTitle",
  "control.useExtraction": "controlUseExtraction",
  "control.useExtractionHint": "controlUseExtractionHint",
  "control.extractionRegex": "controlExtractionRegex",
  "control.injectionPlaceholder": "controlInjectionPlaceholder",
  "control.antiBotTitle": "controlAntiBotTitle",
  "control.humanTyping": "controlHumanTyping",
  "control.humanTypingHint": "controlHumanTypingHint",
  "control.randomDelays": "controlRandomDelays",
  "control.randomDelaysHint": "controlRandomDelaysHint",
  "control.biologicalPauses": "controlBiologicalPauses",
  "control.biologicalPausesHint": "controlBiologicalPausesHint",
  "control.fatigueAfter": "controlFatigueAfter",
  "control.fatigueAfterHint": "controlFatigueAfterHint",
  "control.fatigueMinMinutes": "controlFatigueMinMinutes",
  "control.fatigueMinMinutesHint": "controlFatigueMinMinutesHint",
  "control.fatigueMaxMinutes": "controlFatigueMaxMinutes",
  "control.fatigueMaxMinutesHint": "controlFatigueMaxMinutesHint",
  "stats.total": "statsTotal",
  "stats.completed": "statsCompleted",
  "stats.success": "statsSuccess",
  "stats.failed": "statsFailed",
  "progress.ready": "progressReady",
  "progress.running": "progressRunning",
  "progress.processing": "progressProcessing",
  "progress.paused": "progressPaused",
  "progress.completed": "progressCompleted",
  "log.title": "logTitle",
  "questions.title": "questionsTitle",
  "questions.exportBtn": "questionsExportBtn",
  "questions.clearBtn": "questionsClearBtn",
  "questions.question": "questionsQuestion",
  "questions.answer": "questionsAnswer",
  "questions.sources": "questionsSources",
  "questions.noQuestions": "questionsNoQuestions",
  "questions.addToStart": "questionsAddToStart",
  "questions.noAnswer": "questionsNoAnswer",
  "questions.errorInfo": "questionsErrorInfo",
  "questions.unknownError": "questionsUnknownError",
  "questions.status.pending": "statusPending",
  "questions.status.processing": "statusProcessing",
  "questions.status.completed": "statusCompleted",
  "questions.status.failed": "statusFailed",
  "messages.pleaseEnterQuestion": "msgPleaseEnterQuestion",
  "messages.questionsAdded": "msgQuestionsAdded",
  "messages.inputCleared": "msgInputCleared",
  "messages.alreadyRunning": "msgAlreadyRunning",
  "messages.noQuestions": "msgNoQuestions",
  "messages.executionPaused": "msgExecutionPaused",
  "messages.executionResumed": "msgExecutionResumed",
  "messages.executionStopped": "msgExecutionStopped",
  "messages.noFailedQuestions": "msgNoFailedQuestions",
  "messages.noResults": "msgNoResults",
  "messages.resultsExported": "msgResultsExported",
  "messages.pleaseStopFirst": "msgPleaseStopFirst",
  "messages.confirmClearAll": "msgConfirmClearAll",
  "messages.allCleared": "msgAllCleared",
  "messages.completed": "msgCompleted",
  "messages.failed": "msgFailed",
  "messages.waitingNext": "msgWaitingNext",
  "messages.allCompleted": "msgAllCompleted",
  "messages.openingChatGPT": "msgOpeningChatGPT",
  "messages.cannotOpenChatGPT": "msgCannotOpenChatGPT",
  "messages.error": "msgError",
  "messages.startingBatch": "msgStartingBatch",
  "messages.foundPending": "msgFoundPending",
  "messages.waitingPage": "msgWaitingPage",
  "messages.startingFirst": "msgStartingFirst",
  "messages.resetFailed": "msgResetFailed",
  "messages.submittedWaiting": "msgSubmittedWaiting",
  "messages.processingFailed": "msgProcessingFailed",
  "messages.biologicalPause": "msgBiologicalPause",
  "messages.textInjected": "msgTextInjected",
  "messages.textExtracted": "msgTextExtracted",
  "messages.templateSaved": "msgTemplateSaved",
  "messages.templateUpdated": "msgTemplateUpdated",
  "messages.templateRenamed": "msgTemplateRenamed",
  "messages.templateLoaded": "msgTemplateLoaded",
  "messages.templateDeleted": "msgTemplateDeleted",
  "messages.templateSelectRequired": "msgTemplateSelectRequired",
  "messages.templateNameRequired": "msgTemplateNameRequired",
  "messages.confirmTemplateDelete": "msgConfirmTemplateDelete",
  "messages.invalidExtractionRegex": "msgInvalidExtractionRegex",
  "messages.loadedQuestions": "msgLoadedQuestions",
  "messages.loadFailed": "msgLoadFailed",
  "messages.ready": "msgReady"
};

export function t(key, substitutions) {
  const messageName = KEY_MAP[key] || key;
  let translated;

  if (substitutions) {
    if (typeof substitutions !== "object" || Array.isArray(substitutions)) {
      const values = Array.isArray(substitutions)
        ? substitutions.map(String)
        : String(substitutions);
      translated = chrome.i18n.getMessage(messageName, values);
    } else {
      translated = chrome.i18n.getMessage(
        messageName,
        Object.values(substitutions).map(String)
      );
    }
  } else {
    translated = chrome.i18n.getMessage(messageName);
  }

  if (!translated) {
    return key;
  }

  if (substitutions && typeof substitutions === "object" && !Array.isArray(substitutions)) {
    return translated.replace(/\{(\w+)\}/g, (match, token) => {
      return substitutions[token] !== undefined ? substitutions[token] : match;
    });
  }

  return translated;
}

export function applyTranslations() {
  document.title = t("title");
  document.documentElement.lang = BROWSER_LANG;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.getAttribute("data-i18n"));
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.getAttribute("data-i18n-placeholder"));
  });
}