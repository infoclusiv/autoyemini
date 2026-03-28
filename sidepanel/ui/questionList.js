import { AppState } from "../state/appState.js";
import { t } from "../i18n/i18n.js";

const { escapeHtml } = globalThis.SharedUtils;

export class QuestionList {
  constructor(container) {
    this.container = container;
    AppState.subscribe((state, changedKeys) => {
      if (changedKeys.includes("questions")) {
        this.render(state.questions);
      }
    });
  }

  render(questions = AppState.getState().questions) {
    if (questions.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <p data-i18n="questions.noQuestions">${t("questions.noQuestions")}</p>
          <p data-i18n="questions.addToStart">${t("questions.addToStart")}</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = "";
    [...questions].reverse().forEach((question) => {
      this.container.appendChild(this.createItem(question));
    });
  }

  createItem(question) {
    const item = document.createElement("div");
    item.className = "question-item";
    item.dataset.id = question.id;

    const statusLabel = t(`questions.status.${question.status}`);
    let details = "";

    if (question.status === "completed") {
      const sourcesMarkup = question.sources.length
        ? `
          <div class="detail-section">
            <h4>${t("questions.sources")} (${question.sources.length})</h4>
            <ul class="sources-list">
              ${question.sources
                .map(
                  (source) => `
                    <li class="source-item">
                      <div class="source-title">${escapeHtml(source.title)}</div>
                      <a href="${escapeHtml(source.url)}" target="_blank" class="source-url">${escapeHtml(source.url)}</a>
                      ${source.snippet ? `<div class="source-snippet">${escapeHtml(source.snippet)}</div>` : ""}
                    </li>
                  `
                )
                .join("")}
            </ul>
          </div>
        `
        : "";

      details = `
        <div class="question-details">
          <div class="detail-section">
            <h4>${t("questions.question")}</h4>
            <div class="answer-text">${escapeHtml(question.question)}</div>
          </div>
          <div class="detail-section">
            <h4>${t("questions.answer")}</h4>
            <div class="answer-text">${escapeHtml(question.answer || t("questions.noAnswer"))}</div>
          </div>
          ${sourcesMarkup}
        </div>
      `;
    } else if (question.status === "failed") {
      details = `
        <div class="question-details">
          <div class="detail-section">
            <h4>${t("questions.question")}</h4>
            <div class="answer-text">${escapeHtml(question.question)}</div>
          </div>
          <div class="detail-section">
            <h4>${t("questions.errorInfo")}</h4>
            <div class="error-text">${escapeHtml(question.error || t("questions.unknownError"))}</div>
          </div>
        </div>
      `;
    }

    const completedTime = question.completedAt
      ? new Date(question.completedAt).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";

    item.innerHTML = `
      <div class="question-header">
        <span class="status-badge ${question.status}">${statusLabel}</span>
        <div class="question-text" title="${escapeHtml(question.question)}">${escapeHtml(question.question)}</div>
        ${completedTime ? `<span class="question-time">${completedTime}</span>` : ""}
      </div>
      ${details}
    `;

    item.addEventListener("click", () => {
      item.classList.toggle("expanded");
    });

    return item;
  }
}