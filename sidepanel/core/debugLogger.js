const DEFAULT_MAX_ENTRIES = Math.max(50, Number(globalThis.CONFIG?.LOG_MAX_ENTRIES) || 500);

export const DEBUG_LOG_LEVELS = Object.freeze([
  "DEBUG",
  "INFO",
  "SUCCESS",
  "WARNING",
  "ERROR",
  "CRITICAL"
]);

export const DEBUG_LOG_CATEGORIES = Object.freeze([
  "WORKFLOW",
  "QUESTION",
  "PROVIDER",
  "ANTIBOT",
  "EXTRACTION",
  "BRIDGE",
  "STORAGE",
  "UI",
  "SYSTEM"
]);

function normalizeLevel(level) {
  const value = typeof level === "string" ? level.trim().toUpperCase() : "";
  return DEBUG_LOG_LEVELS.includes(value) ? value : "INFO";
}

function normalizeCategory(category) {
  const value = typeof category === "string" ? category.trim().toUpperCase() : "";
  return value || "SYSTEM";
}

function serializeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || ""
    };
  }

  if (typeof Element !== "undefined" && value instanceof Element) {
    return {
      tag: value.tagName.toLowerCase(),
      id: value.id || null,
      className: typeof value.className === "string" ? value.className : null
    };
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (depth >= 4) {
    return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, 25).map((item) => serializeValue(item, depth + 1, seen));
    if (value.length > 25) {
      items.push(`[+${value.length - 25} more items]`);
    }
    seen.delete(value);
    return items;
  }

  if (value instanceof Map) {
    const mapEntries = Array.from(value.entries()).slice(0, 25).map(([key, item]) => ([
      serializeValue(key, depth + 1, seen),
      serializeValue(item, depth + 1, seen)
    ]));
    seen.delete(value);
    return { mapEntries };
  }

  if (value instanceof Set) {
    const setValues = Array.from(value.values()).slice(0, 25).map((item) => serializeValue(item, depth + 1, seen));
    seen.delete(value);
    return { setValues };
  }

  const result = {};
  const entries = Object.entries(value);
  entries.slice(0, 40).forEach(([key, item]) => {
    result[key] = serializeValue(item, depth + 1, seen);
  });
  if (entries.length > 40) {
    result.__truncatedKeys__ = entries.length - 40;
  }

  seen.delete(value);
  return result;
}

function safeJsonStringify(value, spacing = 2) {
  return JSON.stringify(serializeValue(value), null, spacing);
}

function countBy(entries, field) {
  return entries.reduce((accumulator, entry) => {
    const key = entry[field] || "UNKNOWN";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function buildSearchText(entry) {
  return [
    entry.level,
    entry.category,
    entry.message,
    entry.source,
    entry.workflowContext?.workflowName,
    entry.workflowContext?.stepTitle,
    entry.questionContext?.questionPreview,
    entry.questionContext?.providerLabel,
    entry.details ? safeJsonStringify(entry.details, 0) : "",
    entry.snapshot ? safeJsonStringify(entry.snapshot, 0) : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function indentBlock(text, spaces = 2) {
  const prefix = " ".repeat(spaces);
  return String(text)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatTimestampForText(timestamp) {
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

class DebugLoggerClass {
  constructor() {
    this._entries = [];
    this._listeners = new Set();
    this._maxEntries = DEFAULT_MAX_ENTRIES;
    this._sessionId = this._generateSessionId();
    this._sessionStartTime = Date.now();
    this._contextProvider = null;
  }

  _generateSessionId() {
    const uuid = globalThis.SharedUtils?.generateUUID?.();
    return uuid ? `session-${uuid}` : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _notify(entry, meta = {}) {
    this._listeners.forEach((listener) => {
      try {
        listener(entry, meta);
      } catch {
      }
    });
  }

  _getContext() {
    if (typeof this._contextProvider !== "function") {
      return {
        workflowContext: null,
        questionContext: null,
        snapshot: null,
        systemSnapshot: null
      };
    }

    try {
      const context = this._contextProvider() || {};
      return {
        workflowContext: serializeValue(context.workflowContext) || null,
        questionContext: serializeValue(context.questionContext) || null,
        snapshot: serializeValue(context.snapshot) || null,
        systemSnapshot: serializeValue(context.systemSnapshot || context.snapshot) || null
      };
    } catch (error) {
      return {
        workflowContext: null,
        questionContext: null,
        snapshot: null,
        systemSnapshot: serializeValue({
          contextProviderError: error instanceof Error ? error.message : String(error)
        })
      };
    }
  }

  _createEntry(level, message, options = {}) {
    const context = this._getContext();
    const normalizedLevel = normalizeLevel(level);
    const normalizedCategory = normalizeCategory(options.category);
    const timestampMs = Date.now();

    return {
      id: globalThis.SharedUtils?.generateUUID?.() || `log-${timestampMs}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      level: normalizedLevel,
      category: normalizedCategory,
      message: typeof message === "string" ? message : safeJsonStringify(message, 0),
      details: options.details === undefined ? null : serializeValue(options.details),
      snapshot: options.snapshot === undefined ? context.snapshot : serializeValue(options.snapshot),
      source: typeof options.source === "string" && options.source.trim() ? options.source.trim() : "unknown",
      sessionId: this._sessionId,
      workflowContext: options.workflowContext === undefined
        ? context.workflowContext
        : serializeValue(options.workflowContext),
      questionContext: options.questionContext === undefined
        ? context.questionContext
        : serializeValue(options.questionContext)
    };
  }

  setContextProvider(provider) {
    this._contextProvider = typeof provider === "function" ? provider : null;
  }

  setMaxEntries(value) {
    this._maxEntries = Math.max(50, Number(value) || DEFAULT_MAX_ENTRIES);
    if (this._entries.length > this._maxEntries) {
      this._entries.splice(0, this._entries.length - this._maxEntries);
      this._notify(null, { reset: true });
    }
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {
      };
    }

    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  startSession(options = {}) {
    const { clearEntries = true } = options;
    this._sessionId = this._generateSessionId();
    this._sessionStartTime = Date.now();

    if (clearEntries) {
      this._entries = [];
      this._notify(null, { reset: true });
    }

    return this.info(
      "Nueva sesion de debug iniciada",
      { sessionId: this._sessionId },
      "DebugLogger",
      "SYSTEM"
    );
  }

  log(level, message, options = {}) {
    const entry = this._createEntry(level, message, options);
    this._entries.push(entry);

    const overflow = Math.max(0, this._entries.length - this._maxEntries);
    if (overflow > 0) {
      this._entries.splice(0, overflow);
    }

    this._notify(entry, { pruned: overflow });
    return entry;
  }

  debug(message, details, source, category = "SYSTEM") {
    return this.log("DEBUG", message, { details, source, category });
  }

  info(message, details, source, category = "SYSTEM") {
    return this.log("INFO", message, { details, source, category });
  }

  success(message, details, source, category = "SYSTEM") {
    return this.log("SUCCESS", message, { details, source, category });
  }

  warn(message, details, source, category = "SYSTEM") {
    return this.log("WARNING", message, { details, source, category });
  }

  error(message, details, source, category = "SYSTEM") {
    return this.log("ERROR", message, { details, source, category });
  }

  critical(message, details, source, category = "SYSTEM") {
    return this.log("CRITICAL", message, { details, source, category });
  }

  clear() {
    this._entries = [];
    this._notify(null, { reset: true });
  }

  getSessionId() {
    return this._sessionId;
  }

  getEntries(filter = {}) {
    let entries = [...this._entries];

    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level.map(normalizeLevel) : [normalizeLevel(filter.level)];
      entries = entries.filter((entry) => levels.includes(entry.level));
    }

    if (filter.category) {
      const categories = Array.isArray(filter.category)
        ? filter.category.map(normalizeCategory)
        : [normalizeCategory(filter.category)];
      entries = entries.filter((entry) => categories.includes(normalizeCategory(entry.category)));
    }

    if (filter.sessionId) {
      entries = entries.filter((entry) => entry.sessionId === filter.sessionId);
    }

    if (filter.since) {
      entries = entries.filter((entry) => entry.timestampMs >= Number(filter.since));
    }

    if (filter.search) {
      const search = String(filter.search).toLowerCase().trim();
      if (search) {
        entries = entries.filter((entry) => buildSearchText(entry).includes(search));
      }
    }

    return entries;
  }

  getSystemSnapshot() {
    const context = this._getContext();
    return {
      capturedAt: new Date().toISOString(),
      sessionId: this._sessionId,
      sessionDurationMs: Date.now() - this._sessionStartTime,
      extensionVersion: globalThis.CONFIG?.APP_VERSION || "unknown",
      appName: globalThis.CONFIG?.APP_NAME || "unknown",
      totalLogEntries: this._entries.length,
      state: context.systemSnapshot || context.snapshot || null
    };
  }

  exportAsJSON(filter = {}) {
    const entries = this.getEntries(filter);

    return {
      exportFormat: "autoyepeto-debug-log",
      exportVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      sessionId: this._sessionId,
      entrySummary: {
        total: entries.length,
        byLevel: countBy(entries, "level"),
        byCategory: countBy(entries, "category"),
        timeRangeMs: entries.length > 1 ? entries[entries.length - 1].timestampMs - entries[0].timestampMs : 0
      },
      systemSnapshot: this.getSystemSnapshot(),
      entries
    };
  }

  exportAsText(filter = {}) {
    const exportData = this.exportAsJSON(filter);
    const lines = [
      "=".repeat(88),
      "AUTOYEPETO DEBUG LOG EXPORT",
      `Exported: ${exportData.exportedAt}`,
      `Session: ${exportData.sessionId}`,
      `Version: ${exportData.systemSnapshot.extensionVersion}`,
      `Entries: ${exportData.entrySummary.total}`,
      "=".repeat(88),
      ""
    ];

    exportData.entries.forEach((entry) => {
      lines.push(
        `[${formatTimestampForText(entry.timestamp)}] [${entry.level.padEnd(8)}] [${String(entry.category).padEnd(10)}] [${String(entry.source).padEnd(18)}]`
      );
      lines.push(`  ${entry.message}`);

      if (entry.workflowContext) {
        lines.push(
          `  Workflow: ${entry.workflowContext.workflowName || "unknown"} / step ${Number(entry.workflowContext.stepIndex) + 1} / ${entry.workflowContext.stepTitle || ""}`
        );
      }

      if (entry.questionContext) {
        lines.push(
          `  Question: ${entry.questionContext.providerLabel || entry.questionContext.providerId || "unknown"} / ${entry.questionContext.questionPreview || ""}`
        );
      }

      if (entry.details) {
        lines.push("  Details:");
        lines.push(indentBlock(safeJsonStringify(entry.details), 4));
      }

      if (entry.snapshot) {
        lines.push("  Snapshot:");
        lines.push(indentBlock(safeJsonStringify(entry.snapshot), 4));
      }

      lines.push("");
    });

    lines.push("=".repeat(88));
    lines.push("SYSTEM SNAPSHOT");
    lines.push("=".repeat(88));
    lines.push(safeJsonStringify(exportData.systemSnapshot));
    return lines.join("\n");
  }
}

export const DebugLogger = new DebugLoggerClass();