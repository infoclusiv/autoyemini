import { AppState } from "../state/appState.js";
import { t } from "../i18n/i18n.js";

export class StatsPanel {
  constructor({ totalEl, completedEl, successEl, failedEl, progressFillEl, progressTextEl, progressPercentEl }) {
    this.elements = {
      totalEl,
      completedEl,
      successEl,
      failedEl,
      progressFillEl,
      progressTextEl,
      progressPercentEl
    };

    AppState.subscribe((state, changedKeys) => {
      if (
        changedKeys.includes("questions") ||
        changedKeys.includes("isRunning") ||
        changedKeys.includes("isPaused")
      ) {
        this.render(state);
      }
    });
  }

  updateValue(element, value) {
    const previousValue = parseInt(element.textContent, 10) || 0;
    element.textContent = value;

    if (value > previousValue) {
      element.classList.remove("updated");
      void element.offsetWidth;
      element.classList.add("updated");
      setTimeout(() => {
        element.classList.remove("updated");
      }, 400);
    }
  }

  render(state = AppState.getState()) {
    const total = state.questions.length;
    const completed = state.questions.filter(
      (question) => question.status === "completed" || question.status === "failed"
    ).length;
    const success = state.questions.filter((question) => question.status === "completed").length;
    const failed = state.questions.filter((question) => question.status === "failed").length;
    const processing = state.questions.filter((question) => question.status === "processing").length;

    this.updateValue(this.elements.totalEl, total);
    this.updateValue(this.elements.completedEl, completed);
    this.updateValue(this.elements.successEl, success);
    this.updateValue(this.elements.failedEl, failed);

    const progress = total > 0 ? (completed / total) * 100 : 0;
    this.elements.progressFillEl.style.width = `${progress}%`;
    this.elements.progressPercentEl.textContent = `${Math.round(progress)}%`;

    if (state.isRunning && processing > 0) {
      const processingIndex = state.questions.findIndex((question) => question.status === "processing");
      if (processingIndex !== -1) {
        this.elements.progressTextEl.textContent = t("progress.processing", {
          current: processingIndex + 1,
          total
        });
      } else {
        this.elements.progressTextEl.textContent = t("progress.running");
      }
    } else if (state.isPaused) {
      this.elements.progressTextEl.textContent = t("progress.paused");
    } else if (total > 0 && completed === total) {
      this.elements.progressTextEl.textContent = t("progress.completed");
    } else {
      this.elements.progressTextEl.textContent = t("progress.ready");
    }

    const failedCard = document.querySelector(".stat-failed");
    if (failedCard) {
      failedCard.classList.toggle("stat-muted", failed === 0);
    }
  }
}