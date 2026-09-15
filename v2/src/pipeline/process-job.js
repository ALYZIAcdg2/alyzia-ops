// Traitement d'un job de classification (import_jobs → import_job_results).
// C'est la pièce centrale qui relie tout ce qui a été porté séparément :
// extraction de texte (parsing/), classification par contenu
// (classification/), parseurs par compagnie (parsers/) et extracteur
// nominatif générique (injection/generic-list-extractor.js). Porté verbatim
// depuis src/index.js v1 (lot2ProcessOneJob et fonctions voisines).

import { ensureSchema } from "../db/schema.js";
import { lot2ExtractTextFromR2Object } from "../parsing/document-text.js";
import { lot2DetectListName, lot2LookupListMapping } from "../classification/list-mapping.js";
import {
  lot2ExtractClassCountsForDocument,
  lot2ExtractPassengerCount,
  lot2Preview,
  lot2DocumentTypeFromCard,
  lot2DetectFlightDateFromReportLine,
  lot2ExtractConnectionRows,
  lot2ParseOperationalInfo,
} from "../classification/document-info.js";
import { lot2ExtractPassengerItemsFromGenericList, lot2FqtvCategories } from "../injection/generic-list-extractor.js";
import { IPORT_AIRLINES, IPORT_LIST_LABELS, IPORT_LIST_CARD_KEYS, lot2IportListKindFromBody, lot2IportExtractPassengerItems, lot2IportClassCounts } from "../parsers/iport.js";
import { VF_LIST_LABELS, VF_LIST_CARD_KEYS, lot2VfListKindFromText, lot2VfExtractPassengerItems, lot2VfClassCounts } from "../parsers/vf.js";
import { TW_CONTENT_AIRLINES, lot2TwContentDetect, lot2TwExtractPassengerItems, lot2TwClassCounts } from "../parsers/tw.js";
import { TK_ALLPAX_AIRLINES, lot2TkContentDetect, lot2TkExtractPassengerItems, lot2TkClassCounts } from "../parsers/tk.js";
import { lot2UpdateJobFlightDate } from "./flight-date-update.js";
import { recordImportChange } from "../ingestion/document-store.js";
import { safeJsonParse } from "../lib/json.js";

// Vide depuis l'unification de la classification (toutes les compagnies,
// y compris SQ/TK/TW/BJ, tournent maintenant en GENERIC) — conservé pour
// permettre de reverrouiller une compagnie sur un parseur spécifique si un
// format totalement inattendu apparaissait un jour.
const LOT2_SPECIFIC_AIRLINES = new Set([]);

export async function lot2ProcessOneJob(env, job) {
  const jobId = String(job.job_id || "");
  await env.OPS_DB.prepare(`UPDATE import_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(jobId).run();

  try {
    const version = await env.OPS_DB.prepare(`
      SELECT * FROM import_file_versions WHERE version_id=? LIMIT 1
    `).bind(job.version_id).first();
    if (!version) throw new Error("VERSION INTROUVABLE");
    if (!env.OPS_FILES) throw new Error("BINDING R2 OPS_FILES ABSENT");

    const object = await env.OPS_FILES.get(version.r2_key);
    if (!object) throw new Error("FICHIER R2 INTROUVABLE");

    const filename = version.filename_original || version.filename_normalized || "file";
    const mime = version.mime_type || object.httpMetadata?.contentType || "application/octet-stream";
    const extracted = await lot2ExtractTextFromR2Object(object, filename, mime);
    const airline = String(job.airline || version.airline || "").toUpperCase();
    const parserMode = LOT2_SPECIFIC_AIRLINES.has(airline) ? "SPECIFIC_LOCKED" : "GENERIC";

    let effectiveFlightDate = String(job.flight_date || version.flight_date || "");
    let effectiveJobId = jobId;
    let effectiveFileId = version.file_id;
    let effectiveVersionId = version.version_id;

    // Source iPort (IZ/TB) : format "LIST TOTAL:" texte, jamais "LIST OF:" Altea.
    // Détecté en premier pour ne jamais retomber sur la logique GENERIC/Altea.
    const iportKind = parserMode === "GENERIC" && IPORT_AIRLINES.has(airline) && extracted.readable ? lot2IportListKindFromBody(extracted.text) : "";
    // Source VF (AJet, PD4ML) : "ALL Reservetion List"/"Eticket List"/... jamais
    // "LIST OF:" Altea non plus. BJ partage EXACTEMENT ce même pipeline PD4ML.
    const vfKind = parserMode === "GENERIC" && (airline === "VF" || airline === "BJ") && extracted.readable ? lot2VfListKindFromText(extracted.text) : "";
    // Source TW (corps "CONTENT").
    const twKind = parserMode === "GENERIC" && TW_CONTENT_AIRLINES.has(airline) && extracted.readable ? lot2TwContentDetect(extracted.text) : "";
    // Source TK (multi-sections "ALL PAX"/... END NAMES).
    const tkKind = parserMode === "GENERIC" && TK_ALLPAX_AIRLINES.has(airline) && extracted.readable ? lot2TkContentDetect(extracted.text) : "";
    const specialKind = iportKind || vfKind || twKind || tkKind;

    if (parserMode === "GENERIC" && extracted.readable && !specialKind) {
      const detectedDate = lot2DetectFlightDateFromReportLine(extracted.text, airline, job.flight_number || version.flight_number || "", effectiveFlightDate);
      if (detectedDate.iso && detectedDate.iso !== effectiveFlightDate) {
        const upd = await lot2UpdateJobFlightDate(env, job, version, detectedDate.iso, detectedDate);
        effectiveFlightDate = upd.flightDate || detectedDate.iso;
        effectiveJobId = upd.jobId || effectiveJobId;
        effectiveFileId = upd.fileId || effectiveFileId;
        effectiveVersionId = upd.versionId || effectiveVersionId;
      }
    }

    const operationalInfo = !specialKind && extracted.readable ? lot2ParseOperationalInfo(extracted.text, airline, job.flight_number || version.flight_number || "", effectiveFlightDate) : null;
    const listName = iportKind ? IPORT_LIST_LABELS[iportKind] || iportKind : vfKind ? VF_LIST_LABELS[vfKind] || vfKind : twKind ? "TW CONTENT" : tkKind ? "TK ALL PAX" : lot2DetectListName(extracted.text, filename);
    // Un rapport générique complet (ex. "GENERIC REPORT") porte à la fois
    // l'en-tête opérationnel ET la liste nominative des passagers. Le
    // classer en OPERATIONAL_INFO effacerait les passagers et empêcherait
    // toute création de fiche avec contenu : on détecte donc d'abord un
    // vrai manifeste nominatif avant de retomber sur le mode "info seule".
    const genericManifestItems = !specialKind && !listName && parserMode === "GENERIC" && extracted.readable ? lot2ExtractPassengerItemsFromGenericList(extracted.text, "", "MASTER") : [];
    const listMapping = iportKind
      ? { cardKey: IPORT_LIST_CARD_KEYS[iportKind] || "OTHER", mappingScope: "IPORT", matchedListName: listName }
      : vfKind
      ? // BJ compte le Check-In List Boarded comme les passagers enregistrés
        // en ligne : cardKey "WEB" alimente base.web, plutôt que "BOARDED"
        // qui n'est mappée nulle part. VF n'est pas concerné.
        { cardKey: airline === "BJ" && vfKind === "CHECKIN" ? "WEB" : VF_LIST_CARD_KEYS[vfKind] || "OTHER", mappingScope: "VF", matchedListName: listName }
      : twKind
      ? { cardKey: "MASTER", mappingScope: "TW_CONTENT", matchedListName: listName }
      : tkKind
      ? { cardKey: "MASTER", mappingScope: "TK_ALLPAX", matchedListName: listName }
      : genericManifestItems.length && parserMode === "GENERIC"
      ? { cardKey: "MASTER", mappingScope: "GENERIC_REPORT", matchedListName: "GENERIC REPORT" }
      : operationalInfo && !listName && parserMode === "GENERIC"
      ? { cardKey: "OPERATIONAL_INFO", mappingScope: "OPERATIONAL_INFO", matchedListName: "JFE SCREEN COPY" }
      : parserMode === "SPECIFIC_LOCKED"
      ? { cardKey: "SPECIFIC", mappingScope: "SPECIFIC_LOCKED", matchedListName: "" }
      : lot2LookupListMapping(airline, listName, extracted.text);
    const cardKey = listMapping.cardKey;
    const documentType = cardKey === "OPERATIONAL_INFO" ? "OPERATIONAL_INFO" : lot2DocumentTypeFromCard(cardKey, filename, mime);
    const passengerItems = iportKind
      ? lot2IportExtractPassengerItems(extracted.text, iportKind)
      : vfKind
      ? lot2VfExtractPassengerItems(extracted.text, vfKind)
      : twKind
      ? lot2TwExtractPassengerItems(extracted.text)
      : tkKind
      ? lot2TkExtractPassengerItems(extracted.text)
      : cardKey === "OPERATIONAL_INFO" || !extracted.readable || cardKey === "INBOUND_SUMMARY" || cardKey === "OUTBOUND_SUMMARY"
      ? []
      : lot2ExtractPassengerItemsFromGenericList(extracted.text, listName, cardKey);
    const passengerCount = specialKind ? passengerItems.length : cardKey === "OPERATIONAL_INFO" ? 0 : extracted.readable ? lot2ExtractPassengerCount(extracted.text, listName, cardKey) : 0;
    const classCounts = iportKind
      ? lot2IportClassCounts(passengerItems)
      : vfKind
      ? lot2VfClassCounts(passengerItems)
      : twKind
      ? lot2TwClassCounts(passengerItems)
      : tkKind
      ? lot2TkClassCounts(passengerItems)
      : cardKey === "OPERATIONAL_INFO"
      ? {}
      : extracted.readable
      ? lot2ExtractClassCountsForDocument(extracted.text, listName, cardKey)
      : {};
    const connectionRows = specialKind || cardKey === "OPERATIONAL_INFO" || !extracted.readable ? [] : lot2ExtractConnectionRows(extracted.text, listName, cardKey);
    const fqtvCategories = cardKey === "FQTV" ? lot2FqtvCategories(passengerItems) : {};

    let resultStatus = "CLASSIFIED";
    let changeType = "DOC_CLASSIFIED";

    if (cardKey === "OPERATIONAL_INFO") {
      resultStatus = "OPERATIONAL_INFO_READY";
      changeType = "OPERATIONAL_INFO_READY";
    } else if (parserMode === "SPECIFIC_LOCKED") {
      resultStatus = "READY_SPECIFIC_PARSER";
      changeType = "SPECIFIC_READY";
    } else if (cardKey === "NO_LIST") {
      resultStatus = extracted.readable ? "GENERIC_LIST_NOT_FOUND" : "ARCHIVED_ONLY";
      changeType = extracted.readable ? "GENERIC_LIST_NOT_FOUND" : "ARCHIVED_ONLY";
    } else if (cardKey === "MASTER") {
      resultStatus = "GENERIC_MASTER_READY";
      changeType = "GENERIC_MASTER_READY";
    } else if (cardKey === "OTHER") {
      // OTHER est autorisé uniquement si un vrai "LIST OF: XXXXX" existe
      // mais que XXXXX n'est pas encore mappé.
      resultStatus = extracted.readable ? "GENERIC_CARD_OTHER" : "ARCHIVED_ONLY";
      changeType = extracted.readable ? "GENERIC_CARD_OTHER" : "ARCHIVED_ONLY";
    } else {
      resultStatus = "GENERIC_CARD_READY";
      changeType = "GENERIC_CARD_READY";
    }

    const result = {
      lot: "LOT2",
      parserMode,
      documentType,
      listName,
      cardKey,
      passengerCount,
      classCounts,
      readable: extracted.readable,
      reason: extracted.reason,
      rules: parserMode === "SPECIFIC_LOCKED" ? "Parser spécifique verrouillé : aucune transformation Worker Lot 2." : "GENERIC V50.23 : nettoyage SSR MASTER/TKNE, dossiers propres, inbound noms sur vol réel.",
      mappingScope: listMapping.mappingScope,
      matchedListName: listMapping.matchedListName,
      operationalInfo: operationalInfo || null,
      passengerItems,
      connectionRows,
      fqtvCategories,
    };

    await env.OPS_DB.prepare(`
      INSERT INTO import_job_results
        (job_id,version_id,file_id,airline,flight_number,flight_date,parser_mode,document_type,list_name,card_key,passenger_count,class_counts_json,extracted_text_preview,result_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
        version_id=excluded.version_id,
        file_id=excluded.file_id,
        airline=excluded.airline,
        flight_number=excluded.flight_number,
        flight_date=excluded.flight_date,
        parser_mode=excluded.parser_mode,
        document_type=excluded.document_type,
        list_name=excluded.list_name,
        card_key=excluded.card_key,
        passenger_count=excluded.passenger_count,
        class_counts_json=excluded.class_counts_json,
        extracted_text_preview=excluded.extracted_text_preview,
        result_json=excluded.result_json,
        status=excluded.status,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      effectiveJobId, effectiveVersionId, effectiveFileId, job.airline || "", job.flight_number || "", effectiveFlightDate || job.flight_date || "",
      parserMode, documentType, listName, cardKey, passengerCount, JSON.stringify(classCounts), lot2Preview(extracted.text), JSON.stringify(result), resultStatus
    ).run();

    await env.OPS_DB.prepare(`UPDATE import_file_versions SET status=? WHERE version_id=?`).bind(resultStatus, effectiveVersionId).run();
    await env.OPS_DB.prepare(`UPDATE import_files SET status=?, document_type=?, updated_at=CURRENT_TIMESTAMP WHERE file_id=?`).bind(resultStatus, documentType, effectiveFileId).run();
    await env.OPS_DB.prepare(`UPDATE import_jobs SET status='DONE', error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(effectiveJobId).run();

    await recordImportChange(env, {
      scope: "JOB",
      airline: job.airline,
      flightNumber: job.flight_number,
      flightDate: effectiveFlightDate || job.flight_date,
      gmailMessageId: job.gmail_message_id,
      fileId: effectiveFileId,
      versionId: effectiveVersionId,
      changeType,
      after: result,
    });

    return { ok: true, jobId: effectiveJobId, status: resultStatus, airline: job.airline, flightNumber: job.flight_number, flightDate: effectiveFlightDate || job.flight_date, documentType, listName, cardKey, passengerCount, mappingScope: listMapping.mappingScope, matchedListName: listMapping.matchedListName };
  } catch (e) {
    const msg = String(e?.message || e);
    await env.OPS_DB.prepare(`UPDATE import_jobs SET status='ERROR',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(msg, jobId).run();
    await recordImportChange(env, { scope: "JOB", airline: job.airline, flightNumber: job.flight_number, flightDate: job.flight_date, gmailMessageId: job.gmail_message_id, fileId: job.file_id, versionId: job.version_id, changeType: "JOB_ERROR", after: { error: msg } }).catch(() => {});
    return { ok: false, jobId, error: msg };
  }
}

export async function lot2ProcessNext(env, body) {
  await ensureSchema(env);
  const limit = Math.max(1, Math.min(50, Number(body?.limit || 10)));
  const { results = [] } = await env.OPS_DB.prepare(`
    SELECT *
    FROM import_jobs
    WHERE status='QUEUED'
      AND (run_after IS NULL OR run_after='' OR run_after<=CURRENT_TIMESTAMP)
    ORDER BY priority ASC, created_at DESC
    LIMIT ?
  `).bind(limit).all();

  const processed = [];
  for (const job of results) {
    processed.push(await lot2ProcessOneJob(env, job));
  }
  return { ok: true, requested: limit, found: results.length, processed };
}

export async function lot2Requeue(env, body) {
  await ensureSchema(env);
  const status = String(body?.status || "ERROR").toUpperCase();
  const allowed = new Set(["ERROR", "DONE", "PROCESSING"]);
  if (!allowed.has(status)) return { ok: false, error: "STATUT NON AUTORISÉ" };
  const r = await env.OPS_DB.prepare(`UPDATE import_jobs SET status='QUEUED',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE status=?`).bind(status).run();
  return { ok: true, requeued: r.meta?.changes || 0, fromStatus: status };
}

export async function lot2Results(env, url) {
  await ensureSchema(env);
  const airline = String(url.searchParams.get("airline") || "").toUpperCase();
  const flight = String(url.searchParams.get("flight") || "").toUpperCase();
  const date = String(url.searchParams.get("date") || "");
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
  const wh = [];
  const binds = [];
  if (airline) {
    wh.push("airline=?");
    binds.push(airline);
  }
  if (flight) {
    wh.push("flight_number=?");
    binds.push(flight);
  }
  if (date) {
    wh.push("flight_date=?");
    binds.push(date);
  }
  binds.push(limit);
  const { results = [] } = await env.OPS_DB.prepare(`
    SELECT job_id,version_id,file_id,airline,flight_number,flight_date,parser_mode,document_type,list_name,card_key,passenger_count,class_counts_json,status,updated_at,extracted_text_preview
    FROM import_job_results
    ${wh.length ? `WHERE ${wh.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...binds).all();
  return { ok: true, count: results.length, results: results.map((r) => ({ ...r, class_counts: safeJsonParse(r.class_counts_json, {}) })) };
}

export async function lot2PipelineSummary(env) {
  await ensureSchema(env);
  const jobs = await env.OPS_DB.prepare(`SELECT status,COUNT(*) AS count FROM import_jobs GROUP BY status`).all();
  const files = await env.OPS_DB.prepare(`SELECT status,COUNT(*) AS count FROM import_files GROUP BY status`).all();
  const results = await env.OPS_DB.prepare(`SELECT status,parser_mode,card_key,COUNT(*) AS count FROM import_job_results GROUP BY status,parser_mode,card_key ORDER BY status,parser_mode,card_key`).all();
  const recent = await env.OPS_DB.prepare(`
    SELECT created_at,change_type,airline,flight_number,flight_date,file_id,version_id,after_json
    FROM import_changes
    ORDER BY id DESC
    LIMIT 50
  `).all();
  let cards = { results: [] };
  try {
    cards = await env.OPS_DB.prepare(`SELECT card_key,COUNT(*) AS count,SUM(passenger_count) AS passenger_count FROM flight_import_cards GROUP BY card_key ORDER BY card_key`).all();
  } catch (e) {}
  return { ok: true, jobs: jobs.results || [], files: files.results || [], classified: results.results || [], flightCards: cards.results || [], recentChanges: recent.results || [] };
}
