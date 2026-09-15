// ALYZIA OPS v2 — squelette de construction.
// Ce worker est déployé séparément du worker de production ("alyzia-ops")
// mais partage les mêmes ressources D1 (OPS_DB) et R2 (OPS_FILES), pour
// pouvoir être validé sur de vraies données sans rien dupliquer ni casser
// la prod pendant la construction.

import { ensureSchema } from "./db/schema.js";
import { gmailOAuthStart, gmailOAuthCallback } from "./ingestion/gmail-oauth.js";
import { gmailSyncNow, gmailStatus } from "./ingestion/gmail-sync.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleHealth(env) {
  const checks = {};

  try {
    await ensureSchema(env);
    const row = await env.OPS_DB.prepare("SELECT 1 AS ok").first();
    checks.d1 = row?.ok === 1;
    checks.schema = "22 tables vérifiées (CREATE TABLE IF NOT EXISTS, sans effet sur les tables de prod déjà existantes)";
  } catch (e) {
    checks.d1 = false;
    checks.d1Error = String(e?.message || e);
  }

  try {
    await env.OPS_FILES.list({ limit: 1 });
    checks.r2 = true;
  } catch (e) {
    checks.r2 = false;
    checks.r2Error = String(e?.message || e);
  }

  checks.saria = !!env.SARIA;

  const ok = checks.d1 === true && checks.r2 === true;
  return json({ ok, worker: "alyzia-ops-v2", checks });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (url.pathname === "/api/gmail/oauth/start") {
      return gmailOAuthStart(request, env);
    }

    if (url.pathname === "/api/gmail/oauth/callback") {
      return gmailOAuthCallback(request, env, url);
    }

    if (url.pathname === "/api/gmail/status" && request.method === "GET") {
      return json(await gmailStatus(env));
    }

    // Déclenchement manuel uniquement pendant la construction/validation de
    // v2 : pas de cron tant que ce worker n'a pas été comparé aux résultats
    // réels de la production sur les mêmes mails.
    if (url.pathname === "/api/gmail/sync" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      try {
        return json(await gmailSyncNow(env, body));
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ ok: false, error: "ROUTE INTROUVABLE" }, 404);
  },
};
