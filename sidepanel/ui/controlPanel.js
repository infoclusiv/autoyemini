import { AppState } from "../state/appState.js";

export class ControlPanel {
  constructor({ idleButtons, runningButtons, pausedButtons, retryButtonContainer }) {
    this.elements = { idleButtons, runningButtons, pausedButtons, retryButtonContainer };
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

  render(state = AppState.getState()) {
    this.elements.idleButtons.style.display = "none";
    this.elements.runningButtons.style.display = "none";
    this.elements.pausedButtons.style.display = "none";

    if (state.isRunning) {
      if (state.isPaused) {
        this.elements.pausedButtons.style.display = "flex";
      } else {
        this.elements.runningButtons.style.display = "flex";
      }
    } else {
      this.elements.idleButtons.style.display = "flex";
    }

    this.elements.retryButtonContainer.style.display =
      state.questions.some((question) => question.status === "failed") && !state.isRunning
        ? "flex"
        : "none";
  }
}