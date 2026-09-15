// Construction des "cartes" importées (une par cardKey/liste classifiée) et
// fusion des informations opérationnelles (STD/STA/route/config avion) dans
// la fiche de vol. Porté verbatim depuis src/index.js v1 (LOT 3).

import { lot2Upper } from "../parsing/document-text.js";
import { safeJsonParse } from "../lib/json.js";

export function lot3IdentityFromRow(row) {
  return [String(row?.flight_date || "").trim(), String(row?.airline || "").trim().toUpperCase(), String(row?.flight_number || "").trim().toUpperCase()].join("|");
}

export function lot3CardLabel(cardKey, listName) {
  const c = lot2Upper(cardKey);
  const l = String(listName || "").trim();
  if (c === "FQTV") return "FQTV";
  if (c === "INBOUND") return l.includes("SUMMARY") ? "INBOUND SUMMARY" : "INBOUND";
  if (c === "OUTBOUND") return l.includes("SUMMARY") ? "OUTBOUND SUMMARY" : "OUTBOUND";
  if (c === "MASTER") return "BOOKED / MASTER";
  return c || l || "OTHER";
}

export function lot3SafeResultJson(v) {
  const x = safeJsonParse(v, {});
  return x && typeof x === "object" ? x : {};
}

export function lot3BuildImportCard(row) {
  const result = lot3SafeResultJson(row.result_json);
  const classCounts = safeJsonParse(row.class_counts_json, {});
  return {
    cardKey: String(row.card_key || ""),
    label: lot3CardLabel(row.card_key, row.list_name),
    listName: String(row.list_name || ""),
    documentType: String(row.document_type || row.card_key || ""),
    passengerCount: Number(row.passenger_count || 0),
    classCounts,
    parserMode: String(row.parser_mode || ""),
    status: String(row.status || ""),
    mappingScope: String(result.mappingScope || ""),
    matchedListName: String(result.matchedListName || ""),
    source: {
      jobId: String(row.job_id || ""),
      fileId: String(row.file_id || ""),
      versionId: String(row.version_id || ""),
      injectedAt: new Date().toISOString(),
    },
    // "passengers" et "passengerItems" étaient historiquement dupliqués à
    // l'identique dans la fiche vol JSON alors que seul passengerItems est
    // jamais relu : sur un vol à gros volume (ex. VF avec MASTER 250+/ETKT
    // 240+ passagers), ce doublon fait dépasser la limite de taille D1
    // (SQLITE_TOOBIG) et bloque l'injection de TOUTES les cartes du vol.
    passengerItems: Array.isArray(result.passengerItems) ? result.passengerItems : [],
    connectionRows: Array.isArray(result.connectionRows) ? result.connectionRows : [],
    fqtvCategories: result.fqtvCategories || {},
    rules: "LOT3 : injection depuis import_job_results validé ; n'écrase pas les corrections manuelles.",
  };
}

export async function lot3UpsertFlightCard(env, identity, row, card) {
  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_cards
      (identity,airline,flight_number,flight_date,card_key,list_name,passenger_count,class_counts_json,version_id,file_id,job_id,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(identity,card_key,list_name,version_id) DO UPDATE SET
      passenger_count=excluded.passenger_count,
      class_counts_json=excluded.class_counts_json,
      file_id=excluded.file_id,
      job_id=excluded.job_id,
      result_json=excluded.result_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    identity,
    String(row.airline || "").toUpperCase(),
    String(row.flight_number || "").toUpperCase(),
    String(row.flight_date || ""),
    String(row.card_key || ""),
    String(row.list_name || ""),
    Number(row.passenger_count || 0),
    JSON.stringify(card.classCounts || {}),
    String(row.version_id || ""),
    String(row.file_id || ""),
    String(row.job_id || ""),
    JSON.stringify(card)
  ).run();
}

export function lot3MergeOperationalInfo(existing, row) {
  // V50.20 — injection stricte OPERATIONAL_INFO. On alimente uniquement les
  // champs opérationnels validés : STD/STA, ROUTE, TYPE A/C, CONFIGURATION/
  // CAPACITY, DUREE.
  const result = lot3SafeResultJson(row.result_json);
  const info = result.operationalInfo || {};
  const x = existing && typeof existing === "object" ? { ...existing } : {};

  if (info.date) x.date = info.date;
  if (info.dep) x.dep = info.dep;
  if (info.dest) x.dest = info.dest;
  if (info.std) x.std = info.std;
  if (info.sta) x.sta = info.sta;
  if (info.durationMinutes != null) x.duration = Number(info.durationMinutes); // UI durationText attend des minutes.
  if (info.duration) x.durationLabel = info.duration;
  if (info.durationMinutes != null) x.durationMinutes = info.durationMinutes;
  if (info.aircraft) x.aircraft = info.aircraft;
  // REG/GATE restent manuels. Nettoyage uniquement si une ancienne mauvaise injection numérique existe.
  if (/^\d+$/.test(String(x.reg || ""))) x.reg = "";
  if (info.config) x.config = { ...(x.config || {}), ...info.config };
  if (info.capacity) x.capacity = { ...(x.capacity || {}), ...info.capacity };

  x.imports = x.imports || {};
  x.imports.operationalInfo = {
    ...(x.imports.operationalInfo || {}),
    date: info.date || x.date || "",
    dep: info.dep || x.dep || "",
    dest: info.dest || x.dest || "",
    std: info.std || x.std || "",
    sta: info.sta || x.sta || "",
    duration: info.duration || x.duration || "",
    durationMinutes: info.durationMinutes ?? x.durationMinutes ?? null,
    aircraft: info.aircraft || x.aircraft || "",
    reg: info.reg || x.reg || "",
    config: info.config || x.config || {},
    capacity: info.capacity || x.capacity || {},
    source: { jobId: row.job_id, versionId: row.version_id, fileId: row.file_id },
    updatedAt: new Date().toISOString(),
    rules: "OPERATIONAL_INFO strict : STD/STA, route, type A/C, config/capacity, duration only.",
  };
  x.imports.status = "INJECTED";
  x.imports.lastInjectionAt = new Date().toISOString();
  x.imports.lastInjectionLot = "LOT3_OPERATIONAL_INFO_V50_20";
  return x;
}
