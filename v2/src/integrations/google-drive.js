// Intégration Google Drive directe (V50.5) : connexion OAuth depuis ALYZIA
// OPS (pas d'Apps Script), utilisée pour supprimer un dossier Drive quand un
// vol est supprimé côté ALYZIA. Porté verbatim depuis src/index.js v1
// (googleDriveRedirectUri, googleDriveStatus, getGoogleDriveAccessToken,
// trashDriveFoldersDirect, googleCallbackHtml).

import { getIntegrationJson } from "../db/integrations.js";

export function googleDriveRedirectUri(request) {
  const u = new URL(request.url);
  return `${u.origin}/api/prepa/google-drive/oauth/callback`;
}

export async function googleDriveStatus(env) {
  const cfg = await getIntegrationJson(env, "google_drive_oauth");
  return {
    configured: !!String(cfg?.refresh_token || "").trim(),
    oauthClientConfigured:
      !!String(env.GOOGLE_CLIENT_ID || "").trim() && !!String(env.GOOGLE_CLIENT_SECRET || "").trim(),
    connectedEmail: String(cfg?.email || ""),
    connectedAt: String(cfg?.connected_at || ""),
  };
}

export async function getGoogleDriveAccessToken(env) {
  const cfg = await getIntegrationJson(env, "google_drive_oauth");
  const refreshToken = String(cfg?.refresh_token || "").trim();
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("GOOGLE DRIVE DIRECT NON CONFIGURÉ");
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `GOOGLE TOKEN HTTP ${resp.status}`);
  }
  return String(data.access_token);
}

export async function trashDriveFoldersDirect(env, folderIds) {
  const ids = [...new Set((folderIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: true, trashed: [], missing: [], errors: [] };

  const accessToken = await getGoogleDriveAccessToken(env);
  const trashed = [];
  const missing = [];
  const errors = [];

  for (const id of ids) {
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      },
    );

    if (resp.status === 404) {
      missing.push(id);
      continue;
    }

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      errors.push({
        id,
        status: resp.status,
        error: data?.error?.message || `HTTP ${resp.status}`,
      });
      continue;
    }

    trashed.push(id);
  }

  return { ok: errors.length === 0, trashed, missing, errors };
}

export function googleCallbackHtml(ok, message) {
  const safe = String(message || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ALYZIA OPS · Google Drive</title>
  <style>
  body{font-family:Arial,sans-serif;background:#f4f7fb;color:#10213b;margin:0;display:grid;place-items:center;min-height:100vh}
  .box{background:#fff;border:1px solid #dbe6f2;border-radius:20px;padding:28px;max-width:520px;box-shadow:0 18px 55px #1232}
  h1{margin:0 0 10px;font-size:24px}.ok{color:#16803a}.err{color:#b42318}
  a{display:inline-block;margin-top:18px;background:#0b73e0;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:800}
  </style></head><body><div class="box"><h1 class="${ok ? "ok" : "err"}">${ok ? "GOOGLE DRIVE CONNECTÉ" : "CONNEXION DRIVE IMPOSSIBLE"}</h1><p>${safe}</p><a href="/">RETOUR À ALYZIA OPS</a></div></body></html>`,
    {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" },
    },
  );
}
