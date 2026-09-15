// Point d'entrée de l'injection : prend un résultat classifié
// (import_job_results) et l'injecte dans la fiche de vol (table `flights`),
// ou le met en attente (WAITING_FLIGHT) si la fiche n'existe pas encore.
// Porté verbatim depuis src/index.js v1 (LOT 3).

import { ensureSchema } from "../db/schema.js";
import { getFlightByIdentity, upsertFlight } from "../db/flights.js";
import { recordImportChange } from "../ingestion/document-store.js";
import { safeJsonParse } from "../lib/json.js";
import { lot3IdentityFromRow, lot3SafeResultJson, lot3BuildImportCard, lot3UpsertFlightCard, lot3MergeOperationalInfo } from "./flight-card.js";
import { lot3MergeFlightData } from "./merge-flight-data.js";

export async function lot3InjectOperationalInfo(env, row, options = {}) {
  const identity = lot3IdentityFromRow(row);
  const existing = await getFlightByIdentity(env, identity);
  const before = existing ? JSON.stringify(existing) : null;
  if (!existing && !options.createMissingFlights) {
    await env.OPS_DB.prepare(`UPDATE import_job_results SET status='WAITING_FLIGHT',updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(String(row.job_id || "")).run();
    await recordImportChange(env, { scope: "FLIGHT", airline: row.airline, flightNumber: row.flight_number, flightDate: row.flight_date, fileId: row.file_id, versionId: row.version_id, changeType: "OPERATIONAL_INFO_WAITING_FLIGHT", before: null, after: { identity, row } });
    return { ok: true, identity, airline: row.airline, flightNumber: row.flight_number, flightDate: row.flight_date, cardKey: "OPERATIONAL_INFO", listName: "JFE SCREEN COPY", passengerCount: 0, status: "WAITING_FLIGHT" };
  }

  const afterFlight = lot3MergeOperationalInfo(existing, row);
  afterFlight.airline = afterFlight.airline || String(row.airline || "").toUpperCase();
  afterFlight.flight = afterFlight.flight || String(row.flight_number || "").toUpperCase();
  afterFlight.date = afterFlight.date || String(row.flight_date || "");
  await upsertFlight(env, afterFlight);

  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_injections
      (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(result_job_id) DO UPDATE SET
      identity=excluded.identity,status=excluded.status,before_json=excluded.before_json,after_json=excluded.after_json,updated_at=CURRENT_TIMESTAMP
  `).bind(String(row.job_id || ""), identity, "INJECTED", before, JSON.stringify(afterFlight)).run();

  await env.OPS_DB.prepare(`UPDATE import_job_results SET status='INJECTED',updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(String(row.job_id || "")).run();

  await recordImportChange(env, { scope: "FLIGHT", airline: row.airline, flightNumber: row.flight_number, flightDate: row.flight_date, fileId: row.file_id, versionId: row.version_id, changeType: "OPERATIONAL_INFO_INJECTED", before: before ? safeJsonParse(before, {}) : null, after: { identity, operationalInfo: lot3SafeResultJson(row.result_json).operationalInfo || {} } });

  return { ok: true, identity, airline: row.airline, flightNumber: row.flight_number, flightDate: row.flight_date, cardKey: "OPERATIONAL_INFO", listName: "JFE SCREEN COPY", passengerCount: 0, status: "INJECTED" };
}

export async function lot3InjectOneResult(env, row, options = {}) {
  if (String(row.card_key || "") === "OPERATIONAL_INFO" || String(row.document_type || "") === "OPERATIONAL_INFO") {
    return await lot3InjectOperationalInfo(env, row, options);
  }
  const identity = lot3IdentityFromRow(row);
  let existing = await getFlightByIdentity(env, identity);
  const before = existing ? JSON.stringify(existing) : null;
  const card = lot3BuildImportCard(row);

  // Un Generic Report complet porte une identité, une date, une route et un
  // STD vérifiables. Il peut donc initialiser la fiche réelle avant d'y
  // injecter sa carte. Un document partiel sans route reste WAITING_FLIGHT.
  if (!existing) {
    const info = lot3SafeResultJson(row.result_json).operationalInfo || {};
    if (info.date && info.dep && info.dest && info.std) {
      existing = lot3MergeOperationalInfo(null, row);
      existing.airline = String(row.airline || "").toUpperCase();
      existing.flight = String(row.flight_number || "").toUpperCase();
      existing.date = String(row.flight_date || info.date || "");
      await upsertFlight(env, existing);
    }
  }

  // V50.16 — No stub flight fix. Ne jamais créer une fiche vol vide depuis
  // un import partiel. Si le vol n'existe pas encore dans la table
  // flights, on stocke seulement les cartes importées dans
  // flight_import_cards et on marque WAITING_FLIGHT. La fiche vol sera
  // enrichie quand le vol réel sera présent.
  if (!existing && !options.createMissingFlights) {
    await lot3UpsertFlightCard(env, identity, row, card);

    await env.OPS_DB.prepare(`
      INSERT INTO flight_import_injections
        (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
      VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(result_job_id) DO UPDATE SET
        identity=excluded.identity,
        status=excluded.status,
        before_json=excluded.before_json,
        after_json=excluded.after_json,
        updated_at=CURRENT_TIMESTAMP
    `).bind(String(row.job_id || ""), identity, "WAITING_FLIGHT", null, JSON.stringify({ identity, card })).run();

    await env.OPS_DB.prepare(`
      UPDATE import_job_results
      SET status='WAITING_FLIGHT',
          updated_at=CURRENT_TIMESTAMP
      WHERE job_id=?
    `).bind(String(row.job_id || "")).run();

    await recordImportChange(env, {
      scope: "FLIGHT",
      airline: row.airline,
      flightNumber: row.flight_number,
      flightDate: row.flight_date,
      fileId: row.file_id,
      versionId: row.version_id,
      changeType: "FLIGHT_CARD_WAITING_FLIGHT",
      before: null,
      after: { identity, card },
    });

    return {
      ok: true,
      identity,
      airline: row.airline,
      flightNumber: row.flight_number,
      flightDate: row.flight_date,
      cardKey: row.card_key,
      listName: row.list_name,
      passengerCount: Number(row.passenger_count || 0),
      status: "WAITING_FLIGHT",
    };
  }

  const afterFlight = lot3MergeFlightData(existing, row, card);

  await upsertFlight(env, afterFlight);
  await lot3UpsertFlightCard(env, identity, row, card);

  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_injections
      (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(result_job_id) DO UPDATE SET
      identity=excluded.identity,
      status=excluded.status,
      before_json=excluded.before_json,
      after_json=excluded.after_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(String(row.job_id || ""), identity, "INJECTED", before, JSON.stringify(afterFlight)).run();

  await env.OPS_DB.prepare(`
    UPDATE import_job_results
    SET status='INJECTED',
        updated_at=CURRENT_TIMESTAMP
    WHERE job_id=?
  `).bind(String(row.job_id || "")).run();

  await recordImportChange(env, {
    scope: "FLIGHT",
    airline: row.airline,
    flightNumber: row.flight_number,
    flightDate: row.flight_date,
    fileId: row.file_id,
    versionId: row.version_id,
    changeType: "FLIGHT_CARD_INJECTED",
    before: before ? safeJsonParse(before, {}) : null,
    after: { identity, card },
  });

  return {
    ok: true,
    identity,
    airline: row.airline,
    flightNumber: row.flight_number,
    flightDate: row.flight_date,
    cardKey: row.card_key,
    listName: row.list_name,
    passengerCount: Number(row.passenger_count || 0),
    status: "INJECTED",
  };
}

export async function lot3InjectNext(env, body) {
  await ensureSchema(env);
  const limit = Math.max(1, Math.min(50, Number(body?.limit || 10)));
  const airline = String(body?.airline || "").toUpperCase();
  const flight = String(body?.flight || body?.flightNumber || "").toUpperCase();
  const date = String(body?.date || body?.flightDate || "");

  const wh = ["status IN ('GENERIC_CARD_READY','GENERIC_MASTER_READY','GENERIC_CARD_OTHER','OPERATIONAL_INFO_READY')", "parser_mode='GENERIC'", "card_key IS NOT NULL", "card_key<>''", "card_key<>'NO_LIST'"];
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
    SELECT *
    FROM import_job_results
    WHERE ${wh.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...binds).all();

  const injected = [];
  const options = { createMissingFlights: body?.createMissingFlights === true };
  for (const row of results) {
    injected.push(await lot3InjectOneResult(env, row, options));
  }

  return { ok: true, requested: limit, found: results.length, injected };
}

export async function lot3FlightCards(env, url) {
  await ensureSchema(env);
  const identity = String(url.searchParams.get("identity") || "").trim();
  const airline = String(url.searchParams.get("airline") || "").toUpperCase();
  const flight = String(url.searchParams.get("flight") || "").toUpperCase();
  const date = String(url.searchParams.get("date") || "");

  const wh = [];
  const binds = [];
  if (identity) {
    wh.push("identity=?");
    binds.push(identity);
  }
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

  const { results = [] } = await env.OPS_DB.prepare(`
    SELECT identity,airline,flight_number,flight_date,card_key,list_name,passenger_count,class_counts_json,version_id,file_id,job_id,result_json,updated_at
    FROM flight_import_cards
    ${wh.length ? `WHERE ${wh.join(" AND ")}` : ""}
    ORDER BY identity,card_key,list_name,updated_at DESC
    LIMIT 200
  `).bind(...binds).all();

  return {
    ok: true,
    count: results.length,
    cards: results.map((r) => ({
      ...r,
      class_counts: safeJsonParse(r.class_counts_json, {}),
      result: safeJsonParse(r.result_json, {}),
    })),
  };
}
