import { AppState } from "../state/appState.js";
import { saveQuestions } from "../services/storageService.js";
import { sendToBackground } from "../services/messagingService.js";
import { getStoredStepIndexes } from "../services/workflowService.js";
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
  constructor({ getSettings, addLog, getProviderLabel, onAllCompleted, onWorkflowAbort }) {
    this.getSettings = getSettings;
    this.addLog = addLog;
    this.getProviderLabel = getProviderLabel || ((providerId) => providerId || "chatgpt");
    this.onAllCompleted = onAllCompleted || null;
    this.onWorkflowAbort = onWorkflowAbort || null;
  }

  persistQuestions() {
    return saveQuestions(AppState.getState().questions);
  }

  async maybeTakeBiologicalPause(settings) {
    const state = AppState.getState();
    if (!shouldTakeBiologicalPause(settings, state.processedSincePause)) {
      return;
    }

    this.addLog(t("messages.biologicalPause"), "info", {
      category: "ANTIBOT",
      details: {
        processedSincePause: state.processedSincePause,
        fatigueCount: settings.fatigueCount,
        fatigueMinMinutes: settings.fatigueMinMinutes,
        fatigueMaxMinutes: settings.fatigueMaxMinutes
      }
    });
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
      this.addLog(t("messages.allCompleted"), "success", {
        category: "QUESTION",
        details: {
          totalQuestions: refreshedState.questions.length
        }
      });
      if (this.onAllCompleted) {
        this.onAllCompleted();
      }
      return;
    }

    const nextQuestion = refreshedState.questions[nextIndex];
    const submitResult = buildQuestionForSubmission(
      nextQuestion.question,
      nextQuestion.extractionConfig || antiBotSettings,
      refreshedState.lastExtractedText
    );
    if (submitResult.wasInjected) {
      this.addLog(t("messages.textInjected"), "info", {
        category: "EXTRACTION",
        details: {
          placeholderUsed: nextQuestion.extractionConfig?.injectionPlaceholder || "",
          chainedTextLength: refreshedState.lastExtractedText.length
        }
      });
    }
    const submittedQuestion = submitResult.text;

    AppState.patch({ currentIndex: nextIndex });
    AppState.updateQuestion(nextQuestion.id, { status: "processing" });
    await this.persistQuestions();
    const providerId = nextQuestion.stepProvider || "chatgpt";
    const providerLabel = this.getProviderLabel(providerId);
    this.addLog(
      `[${providerLabel}] [${nextIndex + 1}/${refreshedState.questions.length}]: ${nextQuestion.question.substring(0, 50)}...`,
      "info",
      {
        category: "QUESTION",
        details: {
          questionId: nextQuestion.id,
          providerId,
          providerLabel,
          questionIndex: nextIndex,
          totalQuestions: refreshedState.questions.length
        }
      }
    );

    try {
      const { useTempChat, useWebSearch, keepSameChat } = antiBotSettings;
      const response = await sendToBackground({
        type: "PROCESS_QUESTION",
        providerId,
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

      this.addLog(t("messages.submittedWaiting"), "info", {
        category: "QUESTION",
        details: {
          questionId: nextQuestion.id,
          providerId,
          keepSameChat,
          useTempChat,
          useWebSearch
        }
      });
    } catch (error) {
      AppState.updateQuestion(nextQuestion.id, { status: "failed", error: error.message });
      await this.persistQuestions();
      this.addLog(`${t("messages.processingFailed")}: ${error.message}`, "error", {
        category: "QUESTION",
        details: {
          questionId: nextQuestion.id,
          providerId,
          error: error.message
        }
      });
      AppState.patch({ currentIndex: nextIndex + 1 });

      const latestState = AppState.getState();
      if (latestState.isRunning && !latestState.isPaused) {
        await sleep(2000);
        void this.processNextQuestion();
      }
    }
  }

  _getCurrentStepChainConfig() {
    const state = AppState.getState();
    if (!state.activeWorkflow || !state.workflowContext) {
      return null;
    }

    const stepIndex = state.activeWorkflowStepIndex;
    const step = state.activeWorkflow.steps[stepIndex];
    return step?.chainConfig || null;
  }

  async _handleWorkflowChaining(result, question) {
    const state = AppState.getState();
    const chainConfig = this._getCurrentStepChainConfig();

    if (!chainConfig || !state.workflowContext) {
      return true;
    }

    const { responseAction } = chainConfig;

    if (responseAction === "extract") {
      const defaultRegex =
        AppConfig?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
      const stepRegex =
        chainConfig.extractionRegex ||
        question.extractionConfig?.extractionRegex ||
        defaultRegex;

      try {
        const extractedText = extractTextFromAnswer(result.answer, stepRegex);

        if (!extractedText) {
          this.addLog(
            `Extraction failed: pattern not found in response. Workflow aborted.`,
            "error",
            {
              category: "EXTRACTION",
              details: {
                regex: stepRegex,
                answerPreview: (result.answer || "").substring(0, 200)
              }
            }
          );
          return false;
        }

        const ctx = { ...state.workflowContext };
        ctx.chainedText = extractedText;
        ctx.stepResults = [
          ...ctx.stepResults,
          { stepIndex: state.activeWorkflowStepIndex, action: "extract", text: extractedText, success: true }
        ];
        AppState.patch({ workflowContext: ctx, lastExtractedText: extractedText });
        this.addLog(t("messages.textExtracted"), "success", {
          category: "EXTRACTION",
          details: {
            regex: stepRegex,
            extractedTextLength: extractedText.length
          }
        });
      } catch (error) {
        this.addLog(`Extraction regex error: ${error.message}. Workflow aborted.`, "error", {
          category: "EXTRACTION",
          details: {
            regex: stepRegex,
            error: error.message
          }
        });
        return false;
      }
    } else if (responseAction === "store_full") {
      const fullResponse = result.answer || "";
      const ctx = { ...state.workflowContext };
      ctx.chainedText = fullResponse;
      ctx.stepResults = [
        ...ctx.stepResults,
        { stepIndex: state.activeWorkflowStepIndex, action: "store_full", text: fullResponse.substring(0, 200), success: true }
      ];
      AppState.patch({ workflowContext: ctx, lastExtractedText: fullResponse });
      this.addLog("Full response stored for next step.", "success", {
        category: "EXTRACTION",
        details: {
          responseLength: fullResponse.length,
          stepIndex: state.activeWorkflowStepIndex
        }
      });

      // Auto-save to Ruta de Proyectos via clusiv-v3
      const workflow = state.activeWorkflow;
      const workflowName = workflow.name || "workflow";
      const step = workflow.steps[state.activeWorkflowStepIndex];
      const stepTitle = step?.title || `step_${state.activeWorkflowStepIndex}`;
      const storedStepIndexes = getStoredStepIndexes(workflow);
      const totalStoredSteps = storedStepIndexes.length;
      const isLastStoredStep = storedStepIndexes[storedStepIndexes.length - 1] === state.activeWorkflowStepIndex;
      try {
        const saveResp = await fetch("http://localhost:7788/api/save-step-response", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowName,
            requestId: state.remoteWorkflowRequestId || "",
            projectFolder: state.remoteWorkflowProjectFolder || "",
            stepTitle,
            stepIndex: state.activeWorkflowStepIndex,
            totalStoredSteps,
            totalSteps: totalStoredSteps,
            isLastStoredStep,
            isLastStep: isLastStoredStep,
            answer: fullResponse,
            timestamp: Date.now()
          })
        });
        const saveData = await saveResp.json();
        if (!saveData.success) {
          this.addLog(`Error al guardar en Ruta de Proyectos: ${saveData.error}. Workflow aborted.`, "error", {
            category: "STORAGE",
            details: {
              workflowName,
              stepTitle,
              stepIndex: state.activeWorkflowStepIndex,
              error: saveData.error
            }
          });
          return false;
        }
        this.addLog(`Respuesta guardada en: ${saveData.path}`, "success", {
          category: "STORAGE",
          details: {
            workflowName,
            stepTitle,
            stepIndex: state.activeWorkflowStepIndex,
            path: saveData.path
          }
        });
      } catch (saveError) {
        this.addLog(`Error al guardar en Ruta de Proyectos: ${saveError.message}. Workflow aborted.`, "error", {
          category: "STORAGE",
          details: {
            workflowName,
            stepTitle,
            stepIndex: state.activeWorkflowStepIndex,
            error: saveError.message
          }
        });
        return false;
      }
    } else {
      const ctx = { ...state.workflowContext };
      ctx.stepResults = [
        ...ctx.stepResults,
        { stepIndex: state.activeWorkflowStepIndex, action: "none", text: "", success: true }
      ];
      AppState.patch({ workflowContext: ctx });
    }

    return true;
  }

  async handleQuestionComplete(result) {
    const state = AppState.getState();
    const question = state.questions.find((entry) => entry.id === result.questionId);
    if (!question || question.status === "completed" || question.status === "failed") {
      return;
    }

    const providerLabel = this.getProviderLabel(question.stepProvider || "chatgpt");
    const logPrefix = `[${providerLabel}] `;

    if (result.success) {
      AppState.updateQuestion(result.questionId, {
        status: "completed",
        answer: result.answer,
        sources: result.sources || [],
        completedAt: Date.now()
      });

      // Handle non-workflow extraction has been removed;
      // extraction is now configured per workflow step in chainConfig.

      this.addLog(`${logPrefix}${t("messages.completed")}: ${question.question.substring(0, 50)}...`, "success", {
        category: "QUESTION",
        details: {
          questionId: question.id,
          providerLabel,
          answerLength: typeof result.answer === "string" ? result.answer.length : 0,
          sourcesCount: Array.isArray(result.sources) ? result.sources.length : 0
        }
      });
    } else {
      AppState.updateQuestion(result.questionId, {
        status: "failed",
        error: result.error,
        completedAt: Date.now()
      });

      if (state.activeWorkflow) {
        this.addLog(
          `${logPrefix}${t("messages.failed")}: ${question.question.substring(0, 50)}... - ${result.error}`,
          "error",
          {
            category: "QUESTION",
            details: {
              questionId: question.id,
              providerLabel,
              error: result.error
            }
          }
        );
        this.addLog("Step failed. Workflow aborted.", "error", {
          category: "WORKFLOW",
          details: {
            questionId: question.id,
            providerLabel,
            error: result.error,
            activeStepIndex: state.activeWorkflowStepIndex
          }
        });
        if (this.onWorkflowAbort) {
          this.onWorkflowAbort();
        }
        return;
      }

      this.addLog(
        `${logPrefix}${t("messages.failed")}: ${question.question.substring(0, 50)}... - ${result.error}`,
        "error",
        {
          category: "QUESTION",
          details: {
            questionId: question.id,
            providerLabel,
            error: result.error
          }
        }
      );
    }

    await this.persistQuestions();
    AppState.patch({
      currentIndex: state.currentIndex + 1,
      processedSincePause: state.processedSincePause + 1
    });

    const latestState = AppState.getState();
    if (latestState.isRunning && !latestState.isPaused) {
      // Check if there are more pending questions in this step
      const hasMorePending = latestState.questions.some(
        (q, i) => i >= latestState.currentIndex && q.status === "pending"
      );

      if (!hasMorePending && latestState.activeWorkflow && result.success) {
        // All questions in this step are done - handle workflow chaining before advancing
        const chainSuccess = await this._handleWorkflowChaining(result, question);
        if (!chainSuccess) {
          if (this.onWorkflowAbort) {
            this.onWorkflowAbort();
          }
          return;
        }
      }

      this.addLog(t("messages.waitingNext"), "info", {
        category: "QUESTION",
        details: {
          nextIndex: latestState.currentIndex,
          pendingRemaining: latestState.questions.filter((entry) => entry.status === "pending").length
        }
      });
      await waitForConfiguredDelay(
        AppConfig.TIMING.BETWEEN_QUESTIONS_MS,
        latestState.randomDelays
      );
      void this.processNextQuestion();
    }
  }
}

