function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function escapeHtml(value) {
  if (!value) {
    return "";
  }

  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function normalizeWhitespace(value) {
  return (value || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const SharedUtils = {
  sleep,
  generateUUID,
  escapeHtml,
  normalizeWhitespace
};

globalThis.SharedUtils = SharedUtils;

if (typeof module !== "undefined" && module.exports) {
  module.exports = SharedUtils;
}