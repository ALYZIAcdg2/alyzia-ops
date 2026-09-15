// Neutralisation d'un vol/message PRÉPA après suppression depuis ALYZIA OPS,
// et réparation (remise à PENDING) d'un lot. Porté verbatim depuis
// src/index.js v1 (isPrepaSuppressed, suppressPrepaFlight, repairPrepaScope).
// La création de table est centralisée dans ./schema.js (ensureSchema).

export async function isPrepaSuppressed(env, item) {
  const gmailMessageId = String(item?.gmailMessageId || "").trim();
  if (gmailMessageId) {
    const m = await env.OPS_DB.prepare(`
      SELECT gmail_message_id
      FROM prepa_suppressed_messages
      WHERE gmail_message_id=?
      LIMIT 1
    `).bind(gmailMessageId).first();
    if (m) return { suppressed: true, reason: "MESSAGE" };
  }

  const airline = String(item?.airline || "").trim().toUpperCase();
  const flightNumber = String(item?.flightNumber || "").replace(/\s+/g, "").trim().toUpperCase();
  const flightDate = String(item?.flightDate || "").trim();

  if (airline && flightNumber && flightDate) {
    const f = await env.OPS_DB.prepare(`
      SELECT airline
      FROM prepa_suppressed_flights
      WHERE airline=? AND flight_number=? AND flight_date=?
      LIMIT 1
    `).bind(airline, flightNumber, flightDate).first();
    if (f) return { suppressed: true, reason: "FLIGHT" };
  }

  return { suppressed: false };
}

export async function suppressPrepaFlight(env, { airline, flightNumber, flightDate, prepaRows }) {
  await env.OPS_DB.prepare(`
    INSERT INTO prepa_suppressed_flights
      (airline,flight_number,flight_date,reason,created_at)
    VALUES (?,?,?,'DELETE_FROM_ALYZIA',CURRENT_TIMESTAMP)
    ON CONFLICT(airline,flight_number,flight_date) DO UPDATE SET
      reason='DELETE_FROM_ALYZIA',
      created_at=CURRENT_TIMESTAMP
  `).bind(airline, flightNumber, flightDate).run();

  for (const row of prepaRows || []) {
    const msg = String(row?.gmail_message_id || "").trim();
    if (!msg) continue;
    await env.OPS_DB.prepare(`
      INSERT INTO prepa_suppressed_messages
        (gmail_message_id,airline,flight_number,flight_date,created_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(gmail_message_id) DO UPDATE SET
        airline=excluded.airline,
        flight_number=excluded.flight_number,
        flight_date=excluded.flight_date,
        created_at=CURRENT_TIMESTAMP
    `).bind(msg, airline, flightNumber, flightDate).run();
  }
}

export async function repairPrepaScope(env, body) {
  const scope = String(body?.scope || "").trim().toUpperCase();
  const airline = String(body?.airline || "").trim().toUpperCase();
  const flightNumber = String(body?.flightNumber || "").replace(/\s+/g, "").trim().toUpperCase();
  const flightDate = String(body?.flightDate || "").trim();

  let where = "1=1";
  const binds = [];

  if (scope === "FLIGHT") {
    if (!airline || !flightNumber || !flightDate) throw new Error("VOL / COMPAGNIE / DATE MANQUANTS");
    where += ` AND UPPER(airline)=? AND UPPER(REPLACE(flight_number,' ',''))=? AND flight_date=?`;
    binds.push(airline, flightNumber, flightDate);
  } else if (scope === "AIRLINE") {
    if (!airline) throw new Error("COMPAGNIE MANQUANTE");
    where += ` AND UPPER(airline)=?`;
    binds.push(airline);
  } else if (scope !== "ALL") {
    throw new Error("SCOPE REPAIR INVALIDE");
  }

  where += `
    AND NOT EXISTS (
      SELECT 1
      FROM prepa_suppressed_flights s
      WHERE s.airline=UPPER(prepa_inbox.airline)
        AND s.flight_number=UPPER(REPLACE(prepa_inbox.flight_number,' ',''))
        AND s.flight_date=prepa_inbox.flight_date
    )
    AND NOT EXISTS (
      SELECT 1
      FROM prepa_suppressed_messages sm
      WHERE sm.gmail_message_id=prepa_inbox.gmail_message_id
    )
  `;

  const sql = `
    UPDATE prepa_inbox
    SET
      status='PENDING',
      error_message='',
      processed_at=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE ${where}
  `;

  const result = await env.OPS_DB.prepare(sql).bind(...binds).run();

  return {
    scope,
    airline,
    flightNumber,
    flightDate,
    affected: Number(result.meta?.changes || 0),
  };
}
