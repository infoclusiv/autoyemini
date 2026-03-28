export class LogPanel {
  constructor(container) {
    this.container = container;
    this.maxEntries = globalThis.CONFIG?.LOG_MAX_ENTRIES || 100;
  }

  add(message, level = "info") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.container.appendChild(entry);
    this.container.scrollTop = this.container.scrollHeight;

    while (this.container.children.length > this.maxEntries) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}