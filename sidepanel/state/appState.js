const state = {
  questions: [],
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  useTempChat: true,
  useWebSearch: true,
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