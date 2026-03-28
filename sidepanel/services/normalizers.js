export function normalizeRange(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    const first = Number(value[0]) || fallback[0];
    const second = Number(value[1]) || first;
    return [Math.min(first, second), Math.max(first, second)];
  }

  return [...fallback];
}

export function normalizeNumber(value, fallback, minValue = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(minValue, numericValue);
}

export function normalizeString(value, fallback) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || fallback;
}
