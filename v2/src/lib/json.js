// Porté verbatim depuis src/index.js v1.
export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch (e) {
    return fallback;
  }
}
