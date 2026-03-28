const state = {
  questions: [],
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  useTempChat: true,
  useWebSearch: true,
  keepSameChat: false,
  humanTyping: true,
  randomDelays: true,
  biologicalPauses: false,
  typingSpeed: [...(globalThis.CONFIG?.ANTI_BOT?.TYPING_SPEED_MS || [30, 100])],
  fatigueCount: globalThis.CONFIG?.ANTI_BOT?.FATIGUE_AFTER_QUESTIONS || 10,
  fatigueMinMinutes: 0.5,
  fatigueMaxMinutes: 1,
  processedSincePause: 0,
  lastProcessedMessageTimestamp: 0
};

const listeners = new Set();

function notify(changedKeys) {
  listeners.forEach((listener) => listener(state, changedKeys));
}

export const AppState = {
  getState() {
    return state;
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  patch(patch) {
    Object.assign(state, patch);
    notify(Object.keys(patch));
  },

  setQuestions(questions) {
    state.questions = questions;
    notify(["questions"]);
  },

  updateQuestion(questionId, patch) {
    const question = state.questions.find((entry) => entry.id === questionId);
    if (!question) {
      return null;
    }

    Object.assign(question, patch);
    notify(["questions"]);
    return question;
  }
};