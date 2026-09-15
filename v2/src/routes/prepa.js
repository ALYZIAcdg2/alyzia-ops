// Porté verbatim depuis src/index.js v1 (handlePrepa).

import { json } from "../lib/http.js";
import { isAuthorizedPrepa } from "./auth.js";
import { normalizePrepaPayload, savePrepaInbox, getPrepaInbox, lot5PrepaFastSummaryV535 } from "../db/prepa-inbox.js";
import { isPrepaSuppressed, suppressPrepaFlight, repairPrepaScope } from "../db/prepa-suppression.js";
import { googleDriveStatus, googleDriveRedirectUri, googleCallbackHtml, trashDriveFoldersDirect } from "../integrations/google-drive.js";
import { getIntegrationJson, setIntegrationJson } from "../db/integrations.js";

export async function handlePrepa(request, env, url) {
  if (!url.pathname.startsWith("/api/prepa")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  // GOOGLE APPS SCRIPT -> ALYZIA
  if (url.pathname === "/api/prepa/import" && request.method === "POST") {
    if (!isAuthorizedPrepa(request, env)) {
      return json({ ok: false, error: "NON AUTORISE" }, 401);
    }

    const body = await request.json().catch(() => null);
    const item = normalizePrepaPayload(body);
    if (!item) return json({ ok: false, error: "PREPA INVALIDE" }, 400);

    const suppression = await isPrepaSuppressed(env, item);
    if (suppression.suppressed) {
      return json({
        ok: true,
        accepted: false,
        neutralized: true,
        reason: suppression.reason,
        gmailMessageId: item.gmailMessageId,
        airline: item.airline,
        flightNumber: item.flightNumber,
        flightDate: item.flightDate,
        status: "SUPPRESSED",
      });
    }

    const savedStatus = await savePrepaInbox(env, item);

    return json({
      ok: true,
      accepted: true,
      gmailMessageId: item.gmailMessageId,
      airline: item.airline,
      flightNumber: item.flightNumber,
      flightDate: item.flightDate,
      status: savedStatus,
    });
  }

  // V50.5 — statut connexion Google Drive directe.
  if (url.pathname === "/api/prepa/google-drive/status" && request.method === "GET") {
    return json({ ok: true, ...(await googleDriveStatus(env)) });
  }

  // V50.5 — démarre l'autorisation Google Drive depuis ALYZIA OPS. Pas
  // d'Apps Script.
  if (url.pathname === "/api/prepa/google-drive/oauth/start" && request.method === "POST") {
    const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();

    if (!clientId || !clientSecret) {
      return json({ ok: false, error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET MANQUANTS DANS LE WORKER" }, 409);
    }

    const state = crypto.randomUUID();
    await setIntegrationJson(env, "google_drive_oauth_state", { state, created_at: Date.now() });

    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", googleDriveRedirectUri(request));
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "https://www.googleapis.com/auth/drive");
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("state", state);

    return json({ ok: true, authorizationUrl: auth.toString() });
  }

  // Callback OAuth Google Drive.
  if (url.pathname === "/api/prepa/google-drive/oauth/callback" && request.method === "GET") {
    const code = String(url.searchParams.get("code") || "").trim();
    const state = String(url.searchParams.get("state") || "").trim();
    const err = String(url.searchParams.get("error") || "").trim();

    if (err) return googleCallbackHtml(false, err);
    if (!code || !state) return googleCallbackHtml(false, "CODE / STATE MANQUANT");

    const savedState = await getIntegrationJson(env, "google_drive_oauth_state");
    if (
      !savedState ||
      String(savedState.state || "") !== state ||
      Date.now() - Number(savedState.created_at || 0) > 15 * 60 * 1000
    ) {
      return googleCallbackHtml(false, "STATE OAUTH INVALIDE OU EXPIRÉ");
    }

    const form = new URLSearchParams({
      code,
      client_id: String(env.GOOGLE_CLIENT_ID || ""),
      client_secret: String(env.GOOGLE_CLIENT_SECRET || ""),
      redirect_uri: googleDriveRedirectUri(request),
      grant_type: "authorization_code",
    });

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const token = await resp.json().catch(() => ({}));
    if (!resp.ok || !token?.refresh_token) {
      return googleCallbackHtml(false, token?.error_description || token?.error || `TOKEN HTTP ${resp.status}`);
    }

    // Récupère l'adresse du compte si possible.
    let email = "";
    try {
      const me = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const mj = await me.json();
      email = String(mj?.user?.emailAddress || "");
    } catch (e) {}

    await setIntegrationJson(env, "google_drive_oauth", {
      refresh_token: String(token.refresh_token),
      email,
      connected_at: new Date().toISOString(),
    });

    return googleCallbackHtml(true, email ? `Compte connecté : ${email}` : "Google Drive est prêt.");
  }

  // V50.5 — REPAIR par VOL / COMPAGNIE / TOUT. Les vols neutralisés par
  // suppression ne sont jamais remis à PENDING.
  if (url.pathname === "/api/prepa/repair" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    try {
      const result = await repairPrepaScope(env, body || {});
      return json({ ok: true, ...result });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 400);
    }
  }

  // ALYZIA OPS -> résultat du traitement d'une PREPA. Autorise uniquement
  // PENDING / PROCESSING / PROCESSED / ERROR.
  if (url.pathname === "/api/prepa/status" && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    const id = Number(body?.id);
    const gmailMessageId = String(body?.gmailMessageId || "").trim();
    const status = String(body?.status || "").trim().toUpperCase();
    const errorMessage = String(body?.errorMessage || "").trim();

    const allowed = new Set(["PENDING", "UNIDENTIFIED", "PROCESSING", "PROCESSED", "ERROR"]);

    if (!Number.isFinite(id) || id <= 0 || !gmailMessageId || !allowed.has(status)) {
      return json({ ok: false, error: "STATUT PREPA INVALIDE" }, 400);
    }

    const existing = await env.OPS_DB.prepare(`
      SELECT id, gmail_message_id, status
      FROM prepa_inbox
      WHERE id=? AND gmail_message_id=?
      LIMIT 1
    `).bind(id, gmailMessageId).first();

    if (!existing) return json({ ok: false, error: "PREPA INTROUVABLE" }, 404);

    await env.OPS_DB.prepare(`
      UPDATE prepa_inbox
      SET
        status=?,
        error_message=?,
        processed_at=
          CASE
            WHEN ?='PROCESSED' THEN CURRENT_TIMESTAMP
            ELSE processed_at
          END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND gmail_message_id=?
    `).bind(status, status === "ERROR" ? errorMessage : "", status, id, gmailMessageId).run();

    return json({ ok: true, id, gmailMessageId, status });
  }

  // V50.5 — suppression totale d'un vol importé.
  // - supprime fiche D1 / PREPA / Notes / R2
  // - si deleteDrive=true, supprime directement le dossier Drive via OAuth
  //   Google avant la suppression D1.
  if (url.pathname === "/api/prepa/flight" && request.method === "DELETE") {
    const body = await request.json().catch(() => null);
    const airline = String(body?.airline || "").trim().toUpperCase();
    const flightNumber = String(body?.flightNumber || "").replace(/\s+/g, "").trim().toUpperCase();
    const flightDate = String(body?.flightDate || "").trim();
    const deleteDrive = body?.deleteDrive === true;

    if (!airline || !flightNumber || !flightDate) {
      return json({ ok: false, error: "AIRLINE / FLIGHT / DATE MANQUANTS" }, 400);
    }

    const prepaRows = (await env.OPS_DB.prepare(`
      SELECT id, drive_folder_id, gmail_message_id
      FROM prepa_inbox
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline, flightNumber, flightDate).all()).results || [];

    const driveFolderIds = [...new Set(prepaRows.map((r) => String(r.drive_folder_id || "").trim()).filter(Boolean))];
    const driveStatus = await googleDriveStatus(env);
    let driveDeleteResult = null;

    if (deleteDrive) {
      if (!driveStatus.configured) {
        return json(
          { ok: false, error: "GOOGLE DRIVE DIRECT NON CONFIGURÉ", driveDeleteConfigured: false, googleDrive: driveStatus },
          409,
        );
      }

      driveDeleteResult = await trashDriveFoldersDirect(env, driveFolderIds);

      if (!driveDeleteResult.ok) {
        return json(
          { ok: false, error: "SUPPRESSION DRIVE INCOMPLÈTE", driveDeleteConfigured: true, driveDeleteResult },
          502,
        );
      }
    }

    // Neutralisation AVANT suppression D1 : les messages restent dans
    // Gmail, mais toute nouvelle remontée du Dispatcher sera ignorée par
    // /api/prepa/import.
    await suppressPrepaFlight(env, { airline, flightNumber, flightDate, prepaRows });

    const flightRows = (await env.OPS_DB.prepare(`
      SELECT identity
      FROM flights
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline, flightNumber, flightDate).all()).results || [];

    const identities = [...new Set(flightRows.map((r) => String(r.identity || "").trim()).filter(Boolean))];

    let deletedR2 = 0;
    for (const identity of identities) {
      const attachments = (await env.OPS_DB.prepare(`
        SELECT id, r2_key
        FROM flight_attachments
        WHERE flight_identity=?
      `).bind(identity).all()).results || [];

      if (env.OPS_FILES) {
        for (const att of attachments) {
          const key = String(att.r2_key || "").trim();
          if (key) {
            try {
              await env.OPS_FILES.delete(key);
              deletedR2++;
            } catch (e) {}
          }
        }
      }
      await env.OPS_DB.prepare("DELETE FROM flight_attachments WHERE flight_identity=?").bind(identity).run();
      await env.OPS_DB.prepare("DELETE FROM flight_notes WHERE flight_identity=?").bind(identity).run();
    }

    const fdel = await env.OPS_DB.prepare(`
      DELETE FROM flights
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline, flightNumber, flightDate).run();

    const pdel = await env.OPS_DB.prepare(`
      DELETE FROM prepa_inbox
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline, flightNumber, flightDate).run();

    return json({
      ok: true,
      deleted: true,
      airline,
      flightNumber,
      flightDate,
      driveDeleteConfigured: driveStatus.configured,
      driveDeleteResult,
      neutralized: true,
      driveFolderIds,
      flightsDeleted: Number(fdel.meta?.changes || 0),
      prepaDeleted: Number(pdel.meta?.changes || 0),
      r2Deleted: deletedR2,
      identities,
    });
  }

  // ALYZIA OPS -> lecture boîte PRÉPA
  if (url.pathname === "/api/prepa/summary" && request.method === "GET") {
    return json(await lot5PrepaFastSummaryV535(env));
  }

  if (url.pathname === "/api/prepa" && request.method === "GET") {
    const items = await getPrepaInbox(env, url);
    return json({ ok: true, count: items.length, items });
  }

  return json({ ok: false, error: "ROUTE PREPA INTROUVABLE" }, 404);
}
