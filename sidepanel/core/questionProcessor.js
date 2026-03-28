import { AppState } from "../state/appState.js";
import { saveQuestions } from "../services/storageService.js";
import { sendToBackground } from "../services/messagingService.js";
import { t } from "../i18n/i18n.js";
import { buildQuestionForSubmission, extractTextFromAnswer } from "./extractionEngine.js";
import {
  buildAntiBotConfig,
  shouldTakeBiologicalPause,
  getBiologicalPauseDuration,
  waitForConfiguredDelay
} from "./antiBotController.js";

const { sleep, randomSleep } = globalThis.SharedUtils;
const AppConfig = globalThis.CONFIG;

export function parseQuestionsInput(rawValue, isSinglePrompt) {
  if (isSinglePrompt) {
    return [rawValue];
  }

  const segments = rawValue.includes("===") ? rawValue.split("===") : rawValue.split("\n");
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

export class QuestionProcessor {
  constructor({ getSettings, addLog }) {
    this.getSettings = getSettings;
    this.addLog = addLog;
  }

  persistQuestions() {
    return saveQuestions(AppState.getState().questions);
  }

  async maybeTakeBiologicalPause(settings) {
    const state = AppState.getState();
    if (!shouldTakeBiologicalPause(settings, state.processedSincePause)) {
      return;
    }

    this.addLog(t("messages.biologicalPause"), "info");
    await randomSleep(getBiologicalPauseDuration(settings));

    const latestState = AppState.getState();
    if (!latestState.isRunning || latestState.isPaused) {
      return;
    }

    AppState.patch({ processedSincePause: 0 });
  }

  async processNextQuestion() {
    const state = AppState.getState();
    if (!state.isRunning || state.isPaused) {
      return;
    }

    const antiBotSettings = this.getSettings();
    await this.maybeTakeBiologicalPause(antiBotSettings);

    const refreshedState = AppState.getState();
    if (!refreshedState.isRunning || refreshedState.isPaused) {
      return;
    }

    let nextIndex = -1;
    for (let index = refreshedState.currentIndex; index < refreshedState.questions.length; index += 1) {
      if (refreshedState.questions[index].status === "pending") {
        nextIndex = index;
        break;
      }
    }

    if (nextIndex === -1) {
      AppState.patch({ isRunning: false, lastExtractedText: "" });
      this.addLog(t("messages.allCompleted"), "success");
      return;
    }

    const nextQuestion = refreshedState.questions[nextIndex];
    const submitResult = buildQuestionForSubmission(
      nextQuestion.question,
      nextQuestion.extractionConfig || antiBotSettings,
      refreshedState.lastExtractedText
    );
    if (submitResult.wasInjected) {
      this.addLog(t("messages.textInjected"), "info");
    }
    const submittedQuestion = submitResult.text;

    AppState.patch({ currentIndex: nextIndex });
    AppState.updateQuestion(nextQuestion.id, { status: "processing" });
    await this.persistQuestions();
    this.addLog(
      `[${nextIndex + 1}/${refreshedState.questions.length}]: ${nextQuestion.question.substring(0, 50)}...`,
      "info"
    );

    try {
      const { useTempChat, useWebSearch, keepSameChat } = antiBotSettings;
      const response = await sendToBackground({
        type: "PROCESS_QUESTION",
        question: submittedQuestion,
        questionId: nextQuestion.id,
        useTempChat,
        useWebSearch,
        keepSameChat,
        antiBotConfig: buildAntiBotConfig(antiBotSettings)
      });

      if (!response?.success) {
        throw new Error(response?.error || "No response from background script");
      }

      this.addLog(t("messages.submittedWaiting"), "info");
    } catch (error) {
      AppState.updateQuestion(nextQuestion.id, { status: "failed", error: error.message });
      await this.persistQuestions();
      this.addLog(`${t("messages.processingFailed")}: ${error.message}`, "error");
      AppState.patch({ currentIndex: nextIndex + 1 });

      const latestState = AppState.getState();
      if (latestState.isRunning && !latestState.isPaused) {
        await sleep(2000);
        void this.processNextQuestion();
      }
    }
  }

  async handleQuestionComplete(result) {
    const state = AppState.getState();
    const question = state.questions.find((entry) => entry.id === result.questionId);
    if (!question || question.status === "completed" || question.status === "failed") {
      return;
    }

    if (result.success) {
      AppState.updateQuestion(result.questionId, {
        status: "completed",
        answer: result.answer,
        sources: result.sources || [],
        completedAt: Date.now()
      });

      const extConfig = question.extractionConfig || state;

      if (extConfig.useExtraction) {
        try {
          const extractedText = extractTextFromAnswer(result.answer, extConfig.extractionRegex);
          AppState.patch({ lastExtractedText: extractedText });

          if (extractedText) {
            this.addLog(t("messages.textExtracted"), "success");
          }
        } catch (error) {
          AppState.patch({ lastExtractedText: "" });
          this.addLog(`${t("messages.invalidExtractionRegex")}: ${error.message}`, "warning");
        }
      }

      this.addLog(`${t("messages.completed")}: ${question.question.substring(0, 50)}...`, "success");
    } else {
      AppState.updateQuestion(result.questionId, {
        status: "failed",
        error: result.error,
        completedAt: Date.now()
      });
      const extConfig = question.extractionConfig || state;
      if (extConfig.useExtraction) {
        AppState.patch({ lastExtractedText: "" });
      }
      this.addLog(
        `${t("messages.failed")}: ${question.question.substring(0, 50)}... - ${result.error}`,
        "error"
      );
    }

    await this.persistQuestions();
    AppState.patch({
      currentIndex: state.currentIndex + 1,
      processedSincePause: state.processedSincePause + 1
    });

    const latestState = AppState.getState();
    if (latestState.isRunning && !latestState.isPaused) {
      this.addLog(t("messages.waitingNext"), "info");
      await waitForConfiguredDelay(
        AppConfig.TIMING.BETWEEN_QUESTIONS_MS,
        latestState.randomDelays
      );
      void this.processNextQuestion();
    }
  }
}
