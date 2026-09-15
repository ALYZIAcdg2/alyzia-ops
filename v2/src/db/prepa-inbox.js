// Boîte de réception PRÉPA (imports poussés par le Dispatcher Google Apps
// Script, ou par l'AUTO PILOT Gmail). Porté verbatim depuis src/index.js v1
// (normalizePrepaPayload, savePrepaInbox, getPrepaInbox,
// lot5PrepaFastSummaryV535). La création de table est centralisée dans
// ./schema.js (ensureSchema).

import { ensureAirlineProfile } from "./airline-profiles.js";
import { lot5CanonicalFlightDate } from "../ingestion/dates.js";

export function normalizePrepaPayload(body) {
  if (!body || typeof body !== "object") return null;

  const gmail = body.gmail || {};
  const flight = body.flight || {};
  const email = body.email || {};
  const drive = body.drive || {};
  const detection = body.detection || {};

  const gmailMessageId = String(gmail.messageId || "").trim();
  if (!gmailMessageId) return null;

  const source = String(body.source || "GMAIL").trim().toUpperCase();
  const airline = String(flight.airline || "").trim().toUpperCase();
  const flightNumber = String(flight.flightNumber || "").trim().toUpperCase();
  const flightDate = String(flight.date || "").trim();
  const detectionStatus = String(detection.status || "").trim().toUpperCase();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  // IMPORT IDENTIFIÉ : compagnie + vol + date obligatoires.
  const identified = !!airline && !!flightNumber && !!flightDate;

  // IMPORT NON IDENTIFIÉ : accepté uniquement si le script central l'annonce
  // explicitement ET s'il existe au moins une pièce jointe. Cela évite qu'un
  // mail banal sans vol soit injecté.
  const unidentified =
    !identified &&
    (detectionStatus === "UNIDENTIFIED" || source === "GMAIL_UNIDENTIFIED") &&
    attachments.length > 0;

  if (!identified && !unidentified) return null;

  return {
    gmailMessageId,
    gmailThreadId: String(gmail.threadId || "").trim(),
    source: source || "GMAIL",
    detectionStatus: identified ? "IDENTIFIED" : "UNIDENTIFIED",
    airline: identified ? airline : "",
    flightNumber: identified ? flightNumber : "",
    flightDate: identified ? flightDate : "",
    subject: String(gmail.subject || ""),
    sender: String(gmail.from || ""),
    receivedAt: String(gmail.receivedAt || ""),
    bodyText: String(email.plainText || ""),
    driveFolderId: String(drive.folderId || ""),
    driveEmailPdfId: String(drive.emailPdfId || ""),
    attachments,
  };
}

export async function savePrepaInbox(env, item) {
  if (item?.airline) {
    await ensureAirlineProfile(env, item.airline);
  }

  const attachmentsJson = JSON.stringify(item.attachments || []);
  const initialStatus = item.detectionStatus === "UNIDENTIFIED" ? "UNIDENTIFIED" : "PENDING";

  await env.OPS_DB.prepare(`
    INSERT INTO prepa_inbox (
      gmail_message_id, gmail_thread_id, source,
      airline, flight_number, flight_date,
      subject, sender, received_at,
      body_text,
      drive_folder_id, drive_email_pdf_id,
      attachments_json,
      status, error_message, updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(gmail_message_id)
    DO UPDATE SET
      gmail_thread_id=excluded.gmail_thread_id,
      source=excluded.source,
      airline=excluded.airline,
      flight_number=excluded.flight_number,
      flight_date=excluded.flight_date,
      subject=excluded.subject,
      sender=excluded.sender,
      received_at=excluded.received_at,
      body_text=excluded.body_text,
      drive_folder_id=excluded.drive_folder_id,
      drive_email_pdf_id=excluded.drive_email_pdf_id,
      attachments_json=excluded.attachments_json,
      -- Ne jamais remettre à PENDING un import déjà finalisé. En revanche un
      -- ancien UNIDENTIFIED peut devenir PENDING si le même message est
      -- renvoyé ensuite avec vol/date trouvés.
      status=
        CASE
          WHEN prepa_inbox.status='PROCESSED' THEN 'PROCESSED'
          WHEN excluded.status='PENDING' THEN 'PENDING'
          ELSE excluded.status
        END,
      error_message=
        CASE
          WHEN excluded.status='PENDING' THEN ''
          ELSE prepa_inbox.error_message
        END,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    item.gmailMessageId,
    item.gmailThreadId,
    item.source,
    item.airline,
    item.flightNumber,
    item.flightDate,
    item.subject,
    item.sender,
    item.receivedAt,
    item.bodyText,
    item.driveFolderId,
    item.driveEmailPdfId,
    attachmentsJson,
    initialStatus,
  ).run();

  return initialStatus;
}

export async function getPrepaInbox(env, url) {
  const status = String(url.searchParams.get("status") || "").trim().toUpperCase();
  const airline = String(url.searchParams.get("airline") || "").trim().toUpperCase();
  const flightNumber = String(url.searchParams.get("flight") || "").trim().toUpperCase();

  // V50.4 — sur demande explicite de l'interface, renvoyer aussi les
  // payloads base64 des pièces jointes même si l'import est PROCESSED/ERROR.
  // Utilisé uniquement pour REPRENDRE / RÉINJECTER.
  const includePayload = String(url.searchParams.get("includePayload") || "") === "1";

  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 120)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let sql = `
    SELECT
      id, gmail_message_id, gmail_thread_id,
      source,
      airline, flight_number, flight_date,
      subject, sender, received_at,
      body_text,
      drive_folder_id, drive_email_pdf_id,
      attachments_json,
      status, error_message,
      created_at, updated_at, processed_at
    FROM prepa_inbox
    WHERE 1=1
  `;
  const binds = [];

  if (status) {
    sql += ` AND status=?`;
    binds.push(status);
  }
  if (airline) {
    sql += ` AND airline=?`;
    binds.push(airline);
  }
  if (flightNumber) {
    sql += ` AND flight_number=?`;
    binds.push(flightNumber);
  }

  sql += ` ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await env.OPS_DB.prepare(sql).bind(...binds).all();
  const rows = Array.isArray(result.results) ? result.results : [];

  let items = rows.map((row) => {
    let attachments = [];
    try {
      const parsed = JSON.parse(row.attachments_json || "[]");
      const needsPayload =
        includePayload || status === "PENDING" || status === "PROCESSING" || status === "UNIDENTIFIED";

      attachments = Array.isArray(parsed)
        ? parsed.map((att) => {
            if (needsPayload) return att;
            // Vue OUTILS / historique : on ne renvoie pas les PDF base64.
            // Seulement les métadonnées nécessaires à l'interface.
            return {
              name: String(att?.name || ""),
              mimeType: String(att?.mimeType || ""),
              size: Number(att?.size || 0),
              driveId: String(att?.driveId || ""),
            };
          })
        : [];
    } catch (e) {}

    return {
      id: row.id,
      gmailMessageId: row.gmail_message_id,
      gmailThreadId: row.gmail_thread_id,
      source:
        row.source ||
        (String(row.gmail_message_id || "").startsWith("HISTO_PREPASQ_") ? "HISTORIQUE_PREPASQ" : "GMAIL"),
      airline: row.airline,
      flightNumber: row.flight_number,
      flightDate: row.flight_date,
      subject: row.subject,
      sender: row.sender,
      receivedAt: row.received_at,
      bodyText: row.body_text,
      driveFolderId: row.drive_folder_id,
      driveEmailPdfId: row.drive_email_pdf_id,
      attachments,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      processedAt: row.processed_at,
    };
  });

  // V3.5 : includePayload=1 reconstruit les pièces jointes depuis R2. Les
  // lignes GMAIL_AUTOPILOT ne stockent volontairement que les métadonnées
  // dans prepa_inbox ; le payload complet est fourni à la demande, sans
  // gonfler D1.
  if (includePayload && env.OPS_FILES) {
    const enriched = [];
    for (const item of items) {
      try {
        const versions = (await env.OPS_DB.prepare(`
          SELECT version_id, filename_original, mime_type, file_size, r2_key
          FROM import_file_versions
          WHERE gmail_message_id=?
          ORDER BY created_at ASC
        `).bind(String(item.gmailMessageId || "")).all()).results || [];

        const payload = [];
        for (const v of versions) {
          const obj = await env.OPS_FILES.get(String(v.r2_key || ""));
          if (!obj) continue;
          const bytes = new Uint8Array(await obj.arrayBuffer());
          let bin = "";
          const CH = 0x8000;
          for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
          payload.push({
            name: String(v.filename_original || "prepa.bin"),
            mimeType: String(v.mime_type || "application/octet-stream"),
            size: Number(v.file_size || bytes.length),
            base64: btoa(bin),
            versionId: String(v.version_id || ""),
          });
        }
        enriched.push({ ...item, attachments: payload.length ? payload : item.attachments });
      } catch (e) {
        enriched.push(item);
      }
    }
    items = enriched;
  }

  return items;
}

export async function lot5PrepaFastSummaryV535(env) {
  const rows = (await env.OPS_DB.prepare(`
    SELECT p.gmail_message_id, p.airline, p.flight_number, p.flight_date, p.status, p.attachments_json, p.received_at, p.updated_at,
           g.status AS gmail_status, g.received_at AS gmail_received_at, g.updated_at AS gmail_updated_at
    FROM prepa_inbox p
    LEFT JOIN gmail_messages g ON g.gmail_message_id=p.gmail_message_id
    WHERE p.source='GMAIL_AUTOPILOT'
    ORDER BY p.updated_at DESC
  `).all()).results || [];

  // R4 : toutes les variantes 03SEP / 02SEP26 / YYYYMMDD sont regroupées sous
  // la date ISO. Le statut d'une fiche n'est plus le "pire statut
  // historique". Une ancienne ligne REVIEW ne peut plus contaminer
  // éternellement un vol qui a depuis été injecté/validé.
  const byFlight = new Map();
  let documents = 0;
  let unidentified = 0;

  const stateClass = (st) => {
    st = String(st || "").toUpperCase();
    if (st === "VALIDATED") return "VALIDATED";
    if (st === "INJECTED") return "INJECTED";
    if (st === "IMPORTED" || st === "PROCESSED") return "IMPORTED";
    if (st === "RECEIVED" || st === "PENDING" || st === "PROCESSING") return "RECEIVED";
    if (st === "DUPLICATE") return "DUPLICATE";
    if (st === "ERROR_IMPORT" || st === "ERROR_INJECT" || st === "ERROR") return "ERROR";
    if (st === "REVIEW" || st === "UNIDENTIFIED") return "REVIEW";
    return st || "RECEIVED";
  };
  const ts = (r) => String(r.gmail_updated_at || r.updated_at || r.gmail_received_at || r.received_at || "");

  for (const r of rows) {
    let at = [];
    try {
      at = JSON.parse(r.attachments_json || "[]") || [];
    } catch (e) {}
    const n = Array.isArray(at) ? at.length : 0;
    documents += n;
    const a = String(r.airline || "").toUpperCase();
    const f = String(r.flight_number || "").toUpperCase();
    const d = lot5CanonicalFlightDate(r.flight_date, r.received_at || r.gmail_received_at || "");
    if (!a || !f || !d) {
      unidentified++;
      continue;
    }
    const key = `${a}|${f}|${d}`;
    const rawState = String(r.gmail_status || r.status || "RECEIVED").toUpperCase();
    const st = stateClass(rawState);
    let cur = byFlight.get(key);
    if (!cur) {
      cur = {
        airline: a,
        flightNumber: f,
        flightDate: d,
        status: "RECEIVED",
        messages: 0,
        documents: 0,
        updatedAt: "",
        _states: [],
        _latestSuccess: "",
        _latestBlock: "",
      };
      byFlight.set(key, cur);
    }
    cur.messages++;
    cur.documents += n;
    const t = ts(r);
    if (t > cur.updatedAt) cur.updatedAt = t;
    cur._states.push({ state: st, rawState, t, messageId: String(r.gmail_message_id || "") });
    if ((st === "VALIDATED" || st === "INJECTED") && t > cur._latestSuccess) cur._latestSuccess = t;
    if ((st === "ERROR" || st === "REVIEW") && t > cur._latestBlock) cur._latestBlock = t;
  }

  for (const cur of byFlight.values()) {
    const states = cur._states.map((x) => x.state);
    const has = (x) => states.includes(x);
    const allFinal = states.length > 0 && states.every((x) => x === "VALIDATED" || x === "DUPLICATE");
    const blockingIsNewer = cur._latestBlock && (!cur._latestSuccess || cur._latestBlock > cur._latestSuccess);
    if (allFinal) cur.status = "VALIDATED";
    else if (blockingIsNewer) {
      const blockers = cur._states
        .filter((x) => x.state === "ERROR" || x.state === "REVIEW")
        .sort((a, b) => String(b.t).localeCompare(String(a.t)));
      cur.status = blockers[0]?.state === "ERROR" ? "ERROR_IMPORT" : "REVIEW";
    } else if (has("VALIDATED")) cur.status = "VALIDATED";
    else if (has("INJECTED")) cur.status = "INJECTED";
    else if (has("IMPORTED")) cur.status = "IMPORTED";
    else if (has("RECEIVED")) cur.status = "RECEIVED";
    else if (has("ERROR")) cur.status = "ERROR_IMPORT";
    else if (has("REVIEW")) cur.status = "REVIEW";
    else cur.status = "RECEIVED";
    delete cur._states;
    delete cur._latestSuccess;
    delete cur._latestBlock;
  }

  const flights = [...byFlight.values()].sort(
    (x, y) =>
      String(y.flightDate).localeCompare(String(x.flightDate)) ||
      String(x.airline).localeCompare(String(y.airline)) ||
      String(x.flightNumber).localeCompare(String(y.flightNumber)),
  );
  const counters = { received: 0, imported: 0, injected: 0, validated: 0, errors: 0, review: 0 };
  const companies = {};
  for (const f of flights) {
    const st = f.status;
    if (st === "RECEIVED") counters.received++;
    else if (st === "IMPORTED") counters.imported++;
    else if (st === "INJECTED") counters.injected++;
    else if (st === "VALIDATED") counters.validated++;
    else if (st.startsWith("ERROR")) counters.errors++;
    else if (st === "REVIEW") counters.review++;
    const c =
      companies[f.airline] ||
      (companies[f.airline] = {
        airline: f.airline,
        flights: 0,
        documents: 0,
        received: 0,
        imported: 0,
        injected: 0,
        validated: 0,
        errors: 0,
        review: 0,
      });
    c.flights++;
    c.documents += f.documents;
    if (st === "RECEIVED") c.received++;
    else if (st === "IMPORTED") c.imported++;
    else if (st === "INJECTED") c.injected++;
    else if (st === "VALIDATED") c.validated++;
    else if (st.startsWith("ERROR")) c.errors++;
    else if (st === "REVIEW") c.review++;
  }

  return {
    ok: true,
    r4: true,
    documents,
    flightCount: flights.length,
    unidentified,
    counters,
    companies: Object.values(companies).sort((a, b) => a.airline.localeCompare(b.airline)),
    flights,
  };
}
