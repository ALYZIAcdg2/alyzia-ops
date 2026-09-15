// Boucle de synchronisation Gmail : lit une page de résultats pour une
// requête donnée, stocke chaque mail nouveau ou en erreur (jamais
// retéléchargé s'il est déjà connu et stable), avance le curseur de
// pagination. Porté verbatim depuis src/index.js v1.

import { ensureSchema } from "../db/schema.js";
import { getIntegrationJson } from "../db/integrations.js";
import { gmailFetch } from "./gmail-client.js";
import { storeGmailMessage } from "./store-message.js";

export async function gmailSyncNow(env, body) {
  await ensureSchema(env);
  const query = String(body?.query || "in:anywhere").trim();
  const maxMessages = Math.max(1, Math.min(100, Number(body?.maxMessages || 25)));
  const pageToken = String(body?.pageToken || "").trim();
  const params = new URLSearchParams({ q: query, maxResults: String(maxMessages) });
  if (pageToken) params.set("pageToken", pageToken);
  const list = await gmailFetch(env, `/messages?${params.toString()}`);
  const messages = list.messages || [];
  const results = [];
  const errors = [];

  /*
   * Un cron repasse toujours par la page Gmail la plus récente. Ne pas
   * retélécharger à chaque fois les PDF déjà acquis : cela empêchait le
   * cycle d'atteindre le parsing et l'injection lors des rafales Altea.
   * Les états d'erreur restent rejouables automatiquement.
   */
  const messageIds = messages.map((m) => String(m?.id || "")).filter(Boolean);
  const known = new Map();
  if (messageIds.length) {
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = (await env.OPS_DB.prepare(`
      SELECT
        g.gmail_message_id,
        g.status,
        (SELECT COUNT(*) FROM import_file_versions v WHERE v.gmail_message_id=g.gmail_message_id) AS version_count,
        (SELECT COUNT(*) FROM gmail_message_documents d WHERE d.gmail_message_id=g.gmail_message_id) AS document_link_count
      FROM gmail_messages g
      WHERE g.gmail_message_id IN (${placeholders})
    `).bind(...messageIds).all()).results || [];
    rows.forEach((row) => known.set(String(row.gmail_message_id || ""), row));
  }

  let skippedKnown = 0;
  for (const m of messages) {
    const messageId = String(m?.id || "");
    const prior = known.get(messageId);
    const priorStatus = String(prior?.status || "").toUpperCase();
    const retryable = new Set(["ERROR", "ERROR_IMPORT", "ERROR_INJECT", "REVIEW"]);
    const safelyKnown =
      prior &&
      !retryable.has(priorStatus) &&
      (priorStatus === "IGNORED_NON_OPERATIONAL" || Number(prior.version_count || 0) > 0 || Number(prior.document_link_count || 0) > 0);
    if (safelyKnown) {
      skippedKnown++;
      results.push({ status: priorStatus, messageId, skippedKnown: true });
      continue;
    }
    try {
      results.push(await storeGmailMessage(env, messageId));
    } catch (e) {
      // LOT 5.2 : un mail défectueux ne bloque jamais le reste de la page.
      errors.push({ messageId: String(m?.id || ""), error: String(e?.message || e) });
    }
  }
  await env.OPS_DB.prepare(`
    INSERT INTO gmail_sync_state (mailbox,last_full_sync_at,backfill_query,backfill_page_token,backfill_status,updated_at)
    VALUES ('me',CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(mailbox) DO UPDATE SET
      last_full_sync_at=CURRENT_TIMESTAMP,
      backfill_query=excluded.backfill_query,
      backfill_page_token=excluded.backfill_page_token,
      backfill_status=excluded.backfill_status,
      updated_at=CURRENT_TIMESTAMP
  `).bind(query, String(list.nextPageToken || ""), list.nextPageToken ? "RUNNING" : "DONE").run();
  return {
    ok: errors.length === 0,
    query,
    maxMessages,
    processed: results.length,
    attempted: messages.length,
    failed: errors.length,
    skippedKnown,
    nextPageToken: list.nextPageToken || "",
    results,
    errors,
  };
}

export async function gmailStatus(env) {
  await ensureSchema(env);
  const cfg = await getIntegrationJson(env, "gmail_oauth");
  const row = await env.OPS_DB.prepare(`SELECT * FROM gmail_sync_state WHERE mailbox='me' LIMIT 1`).first();
  const counters = await env.OPS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM gmail_messages) AS messages,
      (SELECT COUNT(*) FROM import_files) AS files,
      (SELECT COUNT(*) FROM import_file_versions) AS versions,
      (SELECT COUNT(*) FROM import_jobs WHERE status='QUEUED') AS queued_jobs,
      (SELECT COUNT(*) FROM import_jobs WHERE status='ERROR') AS error_jobs
  `).first();
  return { ok: true, connected: !!String(cfg?.refresh_token || "").trim(), connectedEmail: String(cfg?.email || ""), connectedAt: String(cfg?.connected_at || ""), syncState: row || null, counters: counters || {} };
}
