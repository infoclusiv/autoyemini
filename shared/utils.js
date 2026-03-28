function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRangeBounds(min, max) {
  if (Array.isArray(min)) {
    const start = Number(min[0]) || 0;
    const end = Number(min[1] ?? min[0]) || start;
    return [Math.min(start, end), Math.max(start, end)];
  }

  const start = Number(min) || 0;
  const end = max === undefined ? start : Number(max) || start;
  return [Math.min(start, end), Math.max(start, end)];
}

function randomInt(min, max) {
  const [start, end] = getRangeBounds(min, max);
  return Math.floor(Math.random() * (end - start + 1)) + start;
}

function randomSleep(min, max) {
  return sleep(randomInt(min, max));
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

function getFixedDelay(delayOrRange) {
  if (Array.isArray(delayOrRange)) {
    return Number(delayOrRange[0]) || 0;
  }

  return Number(delayOrRange) || 0;
}

async function waitForDelay(delayOrRange, useRandomDelays = true) {
  if (useRandomDelays && Array.isArray(delayOrRange)) {
    await randomSleep(delayOrRange);
    return;
  }

  await sleep(getFixedDelay(delayOrRange));
}

const SharedUtils = {
  sleep,
  randomInt,
  randomSleep,
  generateUUID,
  escapeHtml,
  normalizeWhitespace,
  getFixedDelay,
  waitForDelay
};

globalThis.SharedUtils = SharedUtils;

if (typeof module !== "undefined" && module.exports) {
  module.exports = SharedUtils;
}