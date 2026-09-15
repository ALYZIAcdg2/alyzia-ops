// Client Gmail API bas niveau : jeton d'accès (à partir du refresh_token
// stocké en base), requêtes API, décodage base64url, lecture du corps de
// message, hachage SHA-256. Porté verbatim depuis src/index.js v1.

import { getIntegrationJson } from "../db/integrations.js";

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailRedirectUri(request) {
  const u = new URL(request.url);
  return `${u.origin}/api/gmail/oauth/callback`;
}

export async function getGmailAccessToken(env) {
  const cfg = await getIntegrationJson(env, "gmail_oauth");
  const refreshToken = String(cfg?.refresh_token || "").trim();
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!refreshToken || !clientId || !clientSecret) throw new Error("GMAIL API NON CONFIGURÉE");
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const resp = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.access_token) throw new Error(data?.error_description || data?.error || `GMAIL TOKEN HTTP ${resp.status}`);
  return String(data.access_token);
}

export async function gmailFetch(env, path, opts = {}) {
  const token = await getGmailAccessToken(env);
  const resp = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || data?.error_description || `GMAIL HTTP ${resp.status}`);
  return data;
}

export function b64urlToBytes(data) {
  const s = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlToText(data) {
  try {
    return new TextDecoder().decode(b64urlToBytes(data));
  } catch (e) {
    return "";
  }
}

export function extractHeader(message, name) {
  const wanted = String(name || "").toLowerCase();
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  const hit = headers.find((h) => String(h?.name || "").toLowerCase() === wanted);
  return String(hit?.value || "");
}

export function walkParts(part, out = [], path = "0") {
  if (!part) return out;
  const attachmentId = String(part?.body?.attachmentId || "");
  const filename = String(part?.filename || "");
  if (attachmentId || filename) {
    // Stable across Gmail replays: MIME tree path, not Gmail attachmentId.
    part.__cleanSourcePath = String(path);
    out.push(part);
  }
  const children = Array.isArray(part?.parts) ? part.parts : [];
  children.forEach((child, i) => walkParts(child, out, `${path}.${i}`));
  return out;
}

export async function extractPlainBodyFullV1(env, message) {
  let text = "";
  let htmlBody = "";
  async function walk(p) {
    if (!p) return;
    const mt = String(p.mimeType || "").toLowerCase();
    if (mt === "text/plain" && !text) {
      if (p.body?.data) text = b64urlToText(p.body.data);
      else if (p.body?.attachmentId) {
        const a = await gmailFetch(env, `/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(p.body.attachmentId)}`);
        text = b64urlToText(a?.data || "");
      }
    }
    if (mt === "text/html" && !htmlBody) {
      if (p.body?.data) htmlBody = b64urlToText(p.body.data);
      else if (p.body?.attachmentId) {
        const a = await gmailFetch(env, `/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(p.body.attachmentId)}`);
        htmlBody = b64urlToText(a?.data || "");
      }
    }
    for (const c of p.parts || []) await walk(c);
  }
  await walk(message.payload);
  if (text.trim()) return text;
  if (!htmlBody.trim()) return "";
  return htmlBody
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
