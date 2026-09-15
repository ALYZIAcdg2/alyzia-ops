// Connexion OAuth Gmail (obtention du refresh_token stocké en base).
// Porté depuis src/index.js v1 (gmailOAuthStart/gmailOAuthCallback).
//
// Note de portage : la page de confirmation HTML de v1 (googleCallbackHtml)
// est partagée mot pour mot entre le callback Gmail et le callback Google
// Drive, et affiche donc toujours "GOOGLE DRIVE CONNECTÉ" même après avoir
// connecté Gmail — un bug d'affichage cosmétique de copier-coller, sans
// impact sur la logique. Corrigé ici pour dire "GMAIL CONNECTÉ" dans ce
// contexte.

import { setIntegrationJson, getIntegrationJson } from "../db/integrations.js";
import { ensureSchema } from "../db/schema.js";
import { gmailRedirectUri } from "./gmail-client.js";

function googleCallbackHtml(ok, message, serviceLabel) {
  const safe = String(message || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ALYZIA OPS · ${serviceLabel}</title>
  <style>
  body{font-family:Arial,sans-serif;background:#f4f7fb;color:#10213b;margin:0;display:grid;place-items:center;min-height:100vh}
  .box{background:#fff;border:1px solid #dbe6f2;border-radius:20px;padding:28px;max-width:520px;box-shadow:0 18px 55px #1232}
  h1{margin:0 0 10px;font-size:24px}.ok{color:#16803a}.err{color:#b42318}
  a{display:inline-block;margin-top:18px;background:#0b73e0;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:800}
  </style></head><body><div class="box"><h1 class="${ok ? "ok" : "err"}">${ok ? `${serviceLabel.toUpperCase()} CONNECTÉ` : `CONNEXION ${serviceLabel.toUpperCase()} IMPOSSIBLE`}</h1><p>${safe}</p><a href="/">RETOUR À ALYZIA OPS</a></div></body></html>`,
    {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" },
    }
  );
}

export async function gmailOAuthStart(request, env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return new Response(JSON.stringify({ ok: false, error: "GOOGLE_CLIENT_ID MANQUANT" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const state = crypto.randomUUID();
  await setIntegrationJson(env, "gmail_oauth_state", { state, created_at: new Date().toISOString() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(request),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/userinfo.email"].join(" "),
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

export async function gmailOAuthCallback(request, env, url) {
  try {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const saved = await getIntegrationJson(env, "gmail_oauth_state");
    if (!code) throw new Error(url.searchParams.get("error") || "CODE OAUTH MANQUANT");
    if (!saved?.state || state !== saved.state) throw new Error("STATE OAUTH INVALIDE");

    const form = new URLSearchParams({
      client_id: String(env.GOOGLE_CLIENT_ID || ""),
      client_secret: String(env.GOOGLE_CLIENT_SECRET || ""),
      code,
      grant_type: "authorization_code",
      redirect_uri: gmailRedirectUri(request),
    });
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const token = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !token.refresh_token) throw new Error(token.error_description || token.error || "REFRESH TOKEN GMAIL ABSENT");

    const infoResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
    const info = await infoResp.json().catch(() => ({}));
    await setIntegrationJson(env, "gmail_oauth", { refresh_token: token.refresh_token, email: String(info.email || ""), connected_at: new Date().toISOString(), scope: token.scope || "" });
    await ensureSchema(env);
    return googleCallbackHtml(true, `Gmail API connectée : ${String(info.email || "compte Google")}`, "Gmail");
  } catch (e) {
    return googleCallbackHtml(false, String(e?.message || e), "Gmail");
  }
}
