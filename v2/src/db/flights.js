// CRUD pour la table `flights` (une fiche de vol entière stockée en JSON
// dans data_json). Porté verbatim depuis src/index.js v1.

export function flightIdentity(x) {
  return [String(x?.date || "").trim(), String(x?.airline || "").trim().toUpperCase(), String(x?.flight || "").trim().toUpperCase()].join("|");
}

export function validFlight(x) {
  return x && String(x.date || "").trim() && String(x.airline || "").trim() && String(x.flight || "").trim() && String(x.airline || "").trim().toUpperCase() !== "KL";
}

export async function getFlightsResponse(env) {
  // V49.90 RESOURCE FIX — les vols sont déjà stockés en JSON valide dans
  // data_json. On évite de JSON.parse() puis JSON.stringify() chaque vol, ce
  // qui consommait beaucoup de CPU lorsque D1 contenait plusieurs dizaines
  // de fiches volumineuses.
  const { results = [] } = await env.OPS_DB.prepare(`SELECT data_json
              FROM flights
              ORDER BY flight_date, std, flight_number`).all();

  const payload = `{"ok":true,"count":${results.length},"flights":[` + results.map((row) => String(row.data_json || "{}")).join(",") + `]}`;

  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    },
  });
}

export async function upsertFlight(env, x) {
  if (!validFlight(x)) return false;

  const identity = flightIdentity(x);
  await env.OPS_DB.prepare(`
    INSERT INTO flights
      (identity, flight_date, airline, flight_number, std, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(identity) DO UPDATE SET
      flight_date=excluded.flight_date,
      airline=excluded.airline,
      flight_number=excluded.flight_number,
      std=excluded.std,
      data_json=excluded.data_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(identity, String(x.date || ""), String(x.airline || "").toUpperCase(), String(x.flight || "").toUpperCase(), String(x.std || ""), JSON.stringify(x)).run();

  return true;
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (!isPlainObject(patch)) return patch;

  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export async function getFlightByIdentity(env, identity) {
  const row = await env.OPS_DB.prepare(`
    SELECT data_json, updated_at
    FROM flights
    WHERE identity=?
    LIMIT 1
  `).bind(identity).first();

  if (!row) return null;
  try {
    const x = JSON.parse(row.data_json);
    x._serverUpdatedAt = row.updated_at || "";
    return x;
  } catch (e) {
    return null;
  }
}

export async function patchFlight(env, identity, patch) {
  const current = await getFlightByIdentity(env, identity);
  if (!current) return null;

  // Identity fields are server authoritative for PATCH.
  const safePatch = { ...(patch || {}) };
  delete safePatch.date;
  delete safePatch.airline;
  delete safePatch.flight;
  delete safePatch._serverUpdatedAt;

  const merged = deepMerge(current, safePatch);
  merged.date = current.date;
  merged.airline = current.airline;
  merged.flight = current.flight;

  await upsertFlight(env, merged);
  return await getFlightByIdentity(env, identity);
}

export async function syncFlights(env, flights) {
  const clean = [];
  const seen = new Set();

  for (const x of Array.isArray(flights) ? flights : []) {
    if (!validFlight(x)) continue;
    const id = flightIdentity(x);
    if (seen.has(id)) continue;
    seen.add(id);
    clean.push(x);
  }

  // Batch par blocs pour rester robuste même avec un mois complet.
  const CHUNK = 40;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const statements = clean.slice(i, i + CHUNK).map((x) =>
      env.OPS_DB.prepare(`
        INSERT INTO flights
          (identity, flight_date, airline, flight_number, std, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(identity) DO UPDATE SET
          flight_date=excluded.flight_date,
          airline=excluded.airline,
          flight_number=excluded.flight_number,
          std=excluded.std,
          data_json=excluded.data_json,
          updated_at=CURRENT_TIMESTAMP
      `).bind(flightIdentity(x), String(x.date || ""), String(x.airline || "").toUpperCase(), String(x.flight || "").toUpperCase(), String(x.std || ""), JSON.stringify(x))
    );
    if (statements.length) await env.OPS_DB.batch(statements);
  }

  return clean.length;
}
