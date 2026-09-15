// Porté verbatim depuis src/index.js v1.

export function sanitizeR2Segment(value) {
  return (
    String(value || "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "file"
  );
}

export function decodeBase64ToUint8Array(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
