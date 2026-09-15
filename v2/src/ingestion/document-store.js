// Stockage déduppliqué des documents (pièces jointes, corps de mail
// virtuels) dans R2 + indexation D1. Porté verbatim depuis src/index.js v1.
//
// Règle R3.3 : le SHA-256 du contenu est le seul critère de doublon. Un
// document déjà stocké pour le MÊME vol canonique (compagnie/numéro/date)
// est relié (gmail_message_documents) plutôt que ré-écrit, quel que soit le
// nom de fichier ou le type de document historique.

import { normalizeFilename } from "./flight-identity.js";
import { lot5CanonicalFlightDate } from "./dates.js";
import { sha256Hex } from "./gmail-client.js";

export function cleanDocumentFileIdV1(airline, flightNumber, flightDate, docType, sha) {
  return `${String(airline || "UNK").toUpperCase()}|${String(flightNumber || "UNIDENTIFIED").toUpperCase()}|${String(flightDate || "UNKNOWN_DATE")}|${String(docType || "DOCUMENT")}|SHA256:${String(sha || "")}`;
}

export function cleanNormalizeLinkSourceKindV35(v) {
  return String(v || "ATTACHMENT").trim().toUpperCase();
}

export function cleanNormalizeLinkSourceRefV35(v) {
  return String(v || "")
    .trim()
    .replace(/\\+/g, "/")
    .replace(/:{2,}/g, ":")
    .replace(/\/{2,}/g, "/");
}

export function cleanNormalizeParentVersionV35(v) {
  return String(v || "").trim();
}

export async function recordImportChange(env, row) {
  await env.OPS_DB.prepare(`
    INSERT INTO import_changes
      (scope,airline,flight_number,flight_date,gmail_message_id,file_id,version_id,change_type,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(row.scope || "FILE", row.airline || "", row.flightNumber || "", row.flightDate || "", row.gmailMessageId || "", row.fileId || "", row.versionId || "", row.changeType || "", JSON.stringify(row.before || null), JSON.stringify(row.after || null)).run();
}

export async function cleanLinkMessageDocumentV3(env, { gmailMessageId, versionId, fileId, sourceKind = "ATTACHMENT", sourceRef = "", parentVersionId = "", isDuplicate = false }) {
  if (!gmailMessageId || !versionId || !fileId) {
    throw new Error(`LINK_DOCUMENT_INVALID:${String(gmailMessageId || "")}|${String(versionId || "")}|${String(fileId || "")}`);
  }

  const kMessage = String(gmailMessageId);
  const kVersion = String(versionId);
  const kFile = String(fileId);
  const kKind = cleanNormalizeLinkSourceKindV35(sourceKind);
  const kRef = cleanNormalizeLinkSourceRefV35(sourceRef);
  const kParent = cleanNormalizeParentVersionV35(parentVersionId);

  // R3.5 idempotence rule:
  // provenance identity = message + canonical version + normalized source kind + normalized source ref.
  // parent_version_id and is_duplicate are attributes, not part of identity.
  let existing = await env.OPS_DB.prepare(`
    SELECT gmail_message_id,version_id,file_id,source_kind,source_ref,parent_version_id,is_duplicate
    FROM gmail_message_documents
    WHERE gmail_message_id=? AND version_id=? AND source_kind=? AND source_ref=?
    LIMIT 1
  `).bind(kMessage, kVersion, kKind, kRef).first();

  // R3.6 migration bridge: old replays used unstable Gmail attachment ids.
  // For a given message + canonical version + semantic source kind, reuse one old row
  // instead of adding another provenance row. The row is normalized to the new stable ref.
  if (!existing && (kKind === "ATTACHMENT" || kKind.startsWith("EML_"))) {
    existing = await env.OPS_DB.prepare(`
      SELECT gmail_message_id,version_id,file_id,source_kind,source_ref,parent_version_id,is_duplicate
      FROM gmail_message_documents
      WHERE gmail_message_id=? AND version_id=? AND source_kind=?
      ORDER BY created_at ASC
      LIMIT 1
    `).bind(kMessage, kVersion, kKind).first();

    if (existing) {
      await env.OPS_DB.prepare(`
        UPDATE gmail_message_documents
        SET source_ref=?,file_id=?,parent_version_id=?,is_duplicate=?
        WHERE gmail_message_id=? AND version_id=? AND source_kind=? AND source_ref=?
      `).bind(
        kRef, kFile, kParent, Number(existing.is_duplicate || 0) === 1 || isDuplicate ? 1 : 0,
        kMessage, kVersion, kKind, String(existing.source_ref || "")
      ).run();
      existing = { ...existing, source_ref: kRef, file_id: kFile, parent_version_id: kParent, is_duplicate: Number(existing.is_duplicate || 0) === 1 || isDuplicate ? 1 : 0 };
    }
  }

  if (existing) {
    const nextDup = Number(existing.is_duplicate || 0) === 1 || isDuplicate ? 1 : 0;
    if (String(existing.file_id || "") !== kFile || String(existing.parent_version_id || "") !== kParent || Number(existing.is_duplicate || 0) !== nextDup) {
      await env.OPS_DB.prepare(`
        UPDATE gmail_message_documents
        SET file_id=?,parent_version_id=?,is_duplicate=?
        WHERE gmail_message_id=? AND version_id=? AND source_kind=? AND source_ref=?
      `).bind(kFile, kParent, nextDup, kMessage, kVersion, kKind, kRef).run();
    }
    return { ok: true, created: false, row: { gmail_message_id: kMessage, version_id: kVersion, file_id: kFile, source_kind: kKind, source_ref: kRef, parent_version_id: kParent, is_duplicate: nextDup } };
  }

  await env.OPS_DB.prepare(`
    INSERT INTO gmail_message_documents
      (gmail_message_id,version_id,file_id,source_kind,source_ref,parent_version_id,is_duplicate,created_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(kMessage, kVersion, kFile, kKind, kRef, kParent, isDuplicate ? 1 : 0).run();

  return { ok: true, created: true, row: { gmail_message_id: kMessage, version_id: kVersion, file_id: kFile, source_kind: kKind, source_ref: kRef, parent_version_id: kParent, is_duplicate: isDuplicate ? 1 : 0 } };
}

export async function cleanFindExistingVersionByShaV33(env, { sha, airline, flightNumber, flightDate, receivedAt }) {
  if (!sha) return null;
  const rows = (await env.OPS_DB.prepare(`
    SELECT
      v.version_id,
      v.file_id,
      v.gmail_message_id,
      v.attachment_id,
      v.filename_original,
      v.mime_type,
      v.sha256,
      v.created_at,
      f.airline,
      f.flight_number,
      f.flight_date,
      f.document_type
    FROM import_file_versions v
    LEFT JOIN import_files f ON f.file_id=v.file_id
    WHERE v.sha256=?
    ORDER BY v.created_at ASC
    LIMIT 100
  `).bind(String(sha)).all()).results || [];

  const a = String(airline || "").toUpperCase();
  const fn = String(flightNumber || "").toUpperCase();
  const fd = lot5CanonicalFlightDate(flightDate || "", receivedAt) || String(flightDate || "");

  for (const r of rows) {
    const ra = String(r.airline || "").toUpperCase();
    const rf = String(r.flight_number || "").toUpperCase();
    const rd = lot5CanonicalFlightDate(r.flight_date || "", receivedAt) || String(r.flight_date || "");
    if (ra === a && rf === fn && rd === fd) {
      return r;
    }
  }
  return null;
}

export async function cleanStoreDocumentV3(env, { messageId, attachmentId, filename, mime, bytes, receivedAt, flight, docType, sourceKind = "ATTACHMENT", sourceRef = "", parentVersionId = "" }) {
  const airline = String(flight?.airline || "UNK").toUpperCase();
  const flightNumber = String(flight?.flightNumber || "UNIDENTIFIED").toUpperCase();
  const flightDate = lot5CanonicalFlightDate(flight?.flightDate || "", receivedAt) || String(flight?.flightDate || "UNKNOWN_DATE");
  const norm = normalizeFilename(filename);
  const sha = await sha256Hex(bytes);

  // R3.3 — SHA is the duplicate criterion.
  // Reuse an already stored version for the SAME canonical flight/date,
  // regardless of legacy file_id, filename or document_type.
  const shaExisting = await cleanFindExistingVersionByShaV33(env, { sha, airline, flightNumber, flightDate, receivedAt });

  if (shaExisting?.version_id && shaExisting?.file_id) {
    const versionId = String(shaExisting.version_id);
    const fileId = String(shaExisting.file_id);
    await cleanLinkMessageDocumentV3(env, { gmailMessageId: messageId, versionId, fileId, sourceKind, sourceRef, parentVersionId, isDuplicate: true });
    await recordImportChange(env, {
      scope: "FILE", airline, flightNumber, flightDate,
      gmailMessageId: messageId, fileId, versionId,
      changeType: "SHA_DUPLICATE_LINKED_V33",
      after: { filename, sha, sourceKind, sourceRef, reusedVersion: true },
    });
    return { added: 0, updated: 0, duplicate: 1, fileId, versionId, sha, created: false, reused: true };
  }

  const fileId = cleanDocumentFileIdV1(airline, flightNumber, flightDate, docType, sha);
  const versionId = `${fileId}|V1`;
  const r2Key = `prepa/${flightDate}/${airline}/${flightNumber}/${messageId}/${sha}_${norm}`.replace(/\s+/g, "_");

  const existingVersion = await env.OPS_DB.prepare(`SELECT version_id,file_id FROM import_file_versions WHERE version_id=? LIMIT 1`).bind(versionId).first();
  if (existingVersion) {
    await cleanLinkMessageDocumentV3(env, { gmailMessageId: messageId, versionId, fileId, sourceKind, sourceRef, parentVersionId, isDuplicate: true });
    await recordImportChange(env, { scope: "FILE", airline, flightNumber, flightDate, gmailMessageId: messageId, fileId, versionId, changeType: "DUPLICATE_LINKED", after: { filename, sha, sourceKind, sourceRef } });
    return { added: 0, updated: 0, duplicate: 1, fileId, versionId, sha, created: false, reused: true };
  }

  await env.OPS_FILES.put(r2Key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { gmail_message_id: messageId, filename_original: filename, sha256: sha, document_type: docType, source_kind: sourceKind, parent_version_id: parentVersionId || "" },
  });

  await env.OPS_DB.prepare(`
    INSERT INTO import_file_versions
      (version_id,file_id,gmail_message_id,attachment_id,filename_original,filename_normalized,mime_type,file_size,sha256,r2_key,document_time,received_at,status,is_active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'STORED', 1, CURRENT_TIMESTAMP)
  `).bind(versionId, fileId, messageId, attachmentId || sourceRef || sourceKind, filename, norm, mime, bytes.byteLength, sha, r2Key, receivedAt, receivedAt).run();

  await env.OPS_DB.prepare(`
    INSERT INTO import_files
      (file_id,active_version_id,airline,flight_number,flight_date,document_type,filename_normalized,status,latest_document_time,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(file_id) DO UPDATE SET
      active_version_id=excluded.active_version_id,
      airline=excluded.airline,
      flight_number=excluded.flight_number,
      flight_date=excluded.flight_date,
      document_type=excluded.document_type,
      filename_normalized=excluded.filename_normalized,
      status='ADDED',
      latest_document_time=excluded.latest_document_time,
      updated_at=CURRENT_TIMESTAMP
  `).bind(fileId, versionId, airline, flightNumber, flightDate, docType, norm, "ADDED", receivedAt).run();

  await cleanLinkMessageDocumentV3(env, { gmailMessageId: messageId, versionId, fileId, sourceKind, sourceRef, parentVersionId, isDuplicate: false });
  await recordImportChange(env, { scope: "FILE", airline, flightNumber, flightDate, gmailMessageId: messageId, fileId, versionId, changeType: "ADDED_DOCUMENT_V3", after: { filename, sha, r2Key, sourceKind, sourceRef } });

  const priority = docType === "ALL_CUSTOMERS" ? 10 : docType === "PDF" ? 50 : 70;
  await env.OPS_DB.prepare(`
    INSERT INTO import_jobs
      (job_id,job_type,priority,airline,flight_number,flight_date,file_id,version_id,gmail_message_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'QUEUED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(job_id) DO NOTHING
  `).bind(`PARSE|${versionId}`, "PARSE_FILE", priority, airline, flightNumber, flightDate, fileId, versionId, messageId).run();

  return { added: 1, updated: 0, duplicate: 0, fileId, versionId, sha, created: true };
}
