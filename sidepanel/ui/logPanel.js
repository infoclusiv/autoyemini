import {
  DebugLogger,
  DEBUG_LOG_CATEGORIES,
  DEBUG_LOG_LEVELS
} from "../core/debugLogger.js";

function normalizeLevel(level) {
  const value = typeof level === "string" ? level.trim().toUpperCase() : "";
  const aliases = {
    WARN: "WARNING",
    INFO: "INFO",
    SUCCESS: "SUCCESS",
    WARNING: "WARNING",
    ERROR: "ERROR",
    CRITICAL: "CRITICAL",
    DEBUG: "DEBUG"
  };
  return aliases[value] || "INFO";
}

function escapeHtml(value) {
  if (!value) {
    return "";
  }

  if (globalThis.SharedUtils?.escapeHtml) {
    return globalThis.SharedUtils.escapeHtml(String(value));
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function downloadFile(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function buildFileName(prefix, extension) {
  const sessionId = DebugLogger.getSessionId().replace(/[^a-zA-Z0-9-_]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${sessionId}-${timestamp}.${extension}`;
}

export class LogPanel {
  constructor(container) {
    this.container = container;
    this.maxEntries = Math.max(50, Number(globalThis.CONFIG?.LOG_MAX_ENTRIES) || 500);
    this.autoScroll = true;
    this.activeLevels = new Set(DEBUG_LOG_LEVELS);
    this.categoryFilter = "";
    this.searchFilter = "";
    this.searchTimer = null;
    this.unsubscribe = null;

    this._buildDom();
    this._bindEvents();
    this._renderAll();
    this._updateCounts();
    this._updateFooter();

    this.unsubscribe = DebugLogger.subscribe((entry, meta = {}) => {
      if (meta.reset) {
        this._renderAll();
        this._updateCounts();
        this._updateFooter();
        return;
      }

      if (!entry) {
        this._renderAll();
        this._updateCounts();
        this._updateFooter();
        return;
      }

      if (meta.pruned > 0) {
        this._renderAll();
      } else if (this._entryMatches(entry)) {
        this._appendEntry(entry);
      }

      this._updateCounts();
      this._updateFooter();
    });
  }

  add(message, level = "info", metadata = {}, source, details) {
    const normalizedMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {
        category: typeof metadata === "string" ? metadata : undefined,
        source,
        details
      };

    return DebugLogger.log(normalizeLevel(level), message, normalizedMetadata);
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  _buildDom() {
    this.container.innerHTML = `
      <div class="log-panel">
        <div class="log-toolbar">
          <div class="log-filter-levels" id="logLevelFilters"></div>
          <select class="log-category-filter" id="logCategoryFilter"></select>
          <input type="text" class="log-search" id="logSearch" placeholder="Filtrar mensaje o contexto">
          <div class="log-actions">
            <label class="log-autoscroll-toggle" for="logAutoScroll">
              <input type="checkbox" id="logAutoScroll" checked>
              <span>Auto-scroll</span>
            </label>
            <button class="log-btn log-btn-snapshot" id="logBtnSnapshot" type="button" title="Exportar snapshot completo">Snapshot</button>
            <button class="log-btn log-btn-export-json" id="logBtnExportJson" type="button" title="Exportar logs en JSON">JSON</button>
            <button class="log-btn log-btn-export-txt" id="logBtnExportTxt" type="button" title="Exportar logs en texto">TXT</button>
            <button class="log-btn log-btn-clear" id="logBtnClear" type="button" title="Limpiar logs">Clear</button>
          </div>
        </div>
        <div class="log-entries" id="logEntries"></div>
        <div class="log-footer">
          <span class="log-total" id="logTotal">0 visible / 0 total</span>
          <span class="log-session-id" id="logSessionId"></span>
        </div>
      </div>
    `;

    this.levelFiltersEl = this.container.querySelector("#logLevelFilters");
    this.categoryFilterEl = this.container.querySelector("#logCategoryFilter");
    this.searchInputEl = this.container.querySelector("#logSearch");
    this.entriesEl = this.container.querySelector("#logEntries");
    this.totalEl = this.container.querySelector("#logTotal");
    this.sessionEl = this.container.querySelector("#logSessionId");
    this.autoScrollEl = this.container.querySelector("#logAutoScroll");

    DEBUG_LOG_LEVELS.forEach((level) => {
      const label = document.createElement("label");
      label.className = `log-level-pill ${level.toLowerCase()}`;
      label.innerHTML = `
        <input type="checkbox" data-level="${level}" checked>
        <span>${level}</span>
        <span class="log-count" id="cnt-${level}">0</span>
      `;
      this.levelFiltersEl.appendChild(label);
    });

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "Todas las categorias";
    this.categoryFilterEl.appendChild(allOption);

    DEBUG_LOG_CATEGORIES.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      this.categoryFilterEl.appendChild(option);
    });
  }

  _bindEvents() {
    this.container.querySelectorAll("[data-level]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.activeLevels.add(checkbox.dataset.level);
        } else {
          this.activeLevels.delete(checkbox.dataset.level);
        }
        this._renderAll();
        this._updateFooter();
      });
    });

    this.categoryFilterEl.addEventListener("change", (event) => {
      this.categoryFilter = event.target.value;
      this._renderAll();
      this._updateFooter();
    });

    this.searchInputEl.addEventListener("input", (event) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.searchFilter = String(event.target.value || "").trim().toLowerCase();
        this._renderAll();
        this._updateFooter();
      }, 120);
    });

    this.autoScrollEl.addEventListener("change", (event) => {
      this.autoScroll = event.target.checked;
      if (this.autoScroll) {
        this.entriesEl.scrollTop = this.entriesEl.scrollHeight;
      }
    });

    this.container.querySelector("#logBtnExportJson").addEventListener("click", () => {
      const exportData = DebugLogger.exportAsJSON(this._buildFilter());
      downloadFile(
        buildFileName("debug-log", "json"),
        JSON.stringify(exportData, null, 2),
        "application/json"
      );
    });

    this.container.querySelector("#logBtnExportTxt").addEventListener("click", () => {
      downloadFile(
        buildFileName("debug-log", "txt"),
        DebugLogger.exportAsText(this._buildFilter()),
        "text/plain;charset=utf-8"
      );
    });

    this.container.querySelector("#logBtnSnapshot").addEventListener("click", () => {
      downloadFile(
        buildFileName("system-snapshot", "json"),
        JSON.stringify(DebugLogger.getSystemSnapshot(), null, 2),
        "application/json"
      );
    });

    this.container.querySelector("#logBtnClear").addEventListener("click", () => {
      if (!window.confirm("¿Limpiar todos los logs de esta sesion?")) {
        return;
      }

      DebugLogger.clear();
    });
  }

  _buildFilter() {
    const filter = {};

    if (this.activeLevels.size !== DEBUG_LOG_LEVELS.length) {
      filter.level = Array.from(this.activeLevels);
    }

    if (this.categoryFilter) {
      filter.category = this.categoryFilter;
    }

    if (this.searchFilter) {
      filter.search = this.searchFilter;
    }

    return filter;
  }

  _buildSearchText(entry) {
    return [
      entry.message,
      entry.category,
      entry.level,
      entry.source,
      entry.workflowContext?.workflowName,
      entry.workflowContext?.stepTitle,
      entry.questionContext?.questionPreview,
      entry.questionContext?.providerLabel,
      entry.details ? stringify(entry.details) : "",
      entry.snapshot ? stringify(entry.snapshot) : ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  _entryMatches(entry) {
    if (!this.activeLevels.has(entry.level)) {
      return false;
    }

    if (this.categoryFilter && entry.category !== this.categoryFilter) {
      return false;
    }

    if (this.searchFilter && !this._buildSearchText(entry).includes(this.searchFilter)) {
      return false;
    }

    return true;
  }

  _appendEntry(entry) {
    const element = this._createEntryElement(entry);
    const emptyState = this.entriesEl.querySelector(".log-empty-state");
    if (emptyState) {
      emptyState.remove();
    }

    this.entriesEl.appendChild(element);

    while (this.entriesEl.children.length > this.maxEntries) {
      this.entriesEl.removeChild(this.entriesEl.firstChild);
    }

    if (this.autoScroll) {
      this.entriesEl.scrollTop = this.entriesEl.scrollHeight;
    }
  }

  _renderAll() {
    const fragment = document.createDocumentFragment();
    const entries = DebugLogger.getEntries().filter((entry) => this._entryMatches(entry));
    const visibleEntries = entries.slice(-this.maxEntries);

    this.entriesEl.innerHTML = "";

    if (visibleEntries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "log-empty-state";
      empty.textContent = "No hay logs para los filtros actuales.";
      fragment.appendChild(empty);
    } else {
      visibleEntries.forEach((entry) => {
        fragment.appendChild(this._createEntryElement(entry));
      });
    }

    this.entriesEl.appendChild(fragment);

    if (this.autoScroll) {
      this.entriesEl.scrollTop = this.entriesEl.scrollHeight;
    }
  }

  _createEntryElement(entry) {
    const element = document.createElement("article");
    element.className = `log-entry log-level-${entry.level} log-cat-${entry.category}`;
    element.dataset.id = entry.id;

    const hasDetails = Boolean(entry.details || entry.snapshot || entry.questionContext || entry.workflowContext);
    const workflowLabel = entry.workflowContext
      ? `${entry.workflowContext.workflowName || "Workflow"} > Paso ${(Number(entry.workflowContext.stepIndex) || 0) + 1}: ${entry.workflowContext.stepTitle || "Sin titulo"}`
      : "";
    const questionLabel = entry.questionContext
      ? `${entry.questionContext.providerLabel || entry.questionContext.providerId || "provider"}: ${entry.questionContext.questionPreview || ""}`
      : "";

    const detailBlocks = [];
    if (entry.details) {
      detailBlocks.push(`
        <div class="log-entry-block">
          <div class="log-entry-block-title">Details</div>
          <pre class="log-entry-json">${escapeHtml(stringify(entry.details))}</pre>
        </div>
      `);
    }

    if (entry.questionContext) {
      detailBlocks.push(`
        <div class="log-entry-block">
          <div class="log-entry-block-title">Question context</div>
          <pre class="log-entry-json">${escapeHtml(stringify(entry.questionContext))}</pre>
        </div>
      `);
    }

    if (entry.snapshot) {
      detailBlocks.push(`
        <details class="log-entry-snapshot">
          <summary>AppState snapshot</summary>
          <pre class="log-entry-json">${escapeHtml(stringify(entry.snapshot))}</pre>
        </details>
      `);
    }

    element.innerHTML = `
      <div class="log-entry-header">
        <span class="log-entry-timestamp">${escapeHtml(formatTime(entry.timestamp))}</span>
        <span class="log-entry-level ${entry.level}">${escapeHtml(entry.level)}</span>
        <span class="log-entry-category">${escapeHtml(entry.category)}</span>
        <span class="log-entry-source">${escapeHtml(entry.source)}</span>
        ${workflowLabel ? `<span class="log-entry-workflow-ctx" title="${escapeHtml(workflowLabel)}">${escapeHtml(workflowLabel)}</span>` : ""}
        ${hasDetails ? '<button class="log-entry-expand" type="button" aria-expanded="false">Show</button>' : ""}
      </div>
      <div class="log-entry-message">${escapeHtml(entry.message)}</div>
      ${questionLabel ? `<div class="log-entry-question-ctx">${escapeHtml(questionLabel)}</div>` : ""}
      ${hasDetails ? `<div class="log-entry-details" hidden>${detailBlocks.join("")}</div>` : ""}
    `;

    if (hasDetails) {
      const toggle = element.querySelector(".log-entry-expand");
      const detailsEl = element.querySelector(".log-entry-details");
      toggle.addEventListener("click", () => {
        const nextHidden = !detailsEl.hidden;
        detailsEl.hidden = nextHidden;
        toggle.setAttribute("aria-expanded", String(!nextHidden));
        toggle.textContent = nextHidden ? "Show" : "Hide";
      });
    }

    return element;
  }

  _updateCounts() {
    const entries = DebugLogger.getEntries();
    DEBUG_LOG_LEVELS.forEach((level) => {
      const count = entries.filter((entry) => entry.level === level).length;
      const countElement = this.container.querySelector(`#cnt-${level}`);
      if (countElement) {
        countElement.textContent = String(count);
      }
    });
  }

  _updateFooter() {
    const total = DebugLogger.getEntries().length;
    const visible = DebugLogger.getEntries(this._buildFilter()).length;
    this.totalEl.textContent = `${visible} visible / ${total} total`;
    this.sessionEl.textContent = DebugLogger.getSessionId();
  }
}