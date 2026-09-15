// Porté verbatim depuis src/index.js v1 (handleFlights).

import { json } from "../lib/http.js";
import { flightIdentity, validFlight, getFlightsResponse, upsertFlight, getFlightByIdentity, patchFlight, syncFlights } from "../db/flights.js";

export async function handleFlights(request, env, url) {
  if (request.method === "OPTIONS") return json({ ok: true });

  if (url.pathname === "/api/flights" && request.method === "GET") {
    const identity = String(url.searchParams.get("identity") || "").trim();
    if (identity) {
      const flight = await getFlightByIdentity(env, identity);
      if (!flight) return json({ ok: false, error: "VOL INTROUVABLE" }, 404);
      return json({ ok: true, flight });
    }

    return await getFlightsResponse(env);
  }

  if (url.pathname === "/api/flights" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!validFlight(body?.flight)) return json({ ok: false, error: "VOL INVALIDE" }, 400);
    await upsertFlight(env, body.flight);
    const identity = flightIdentity(body.flight);
    const flight = await getFlightByIdentity(env, identity);
    return json({ ok: true, identity, flight });
  }

  if (url.pathname === "/api/flights" && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    const identity = String(body?.identity || "").trim();
    const patch = body?.patch;
    if (!identity || !patch || typeof patch !== "object") {
      return json({ ok: false, error: "IDENTITY OU PATCH MANQUANT" }, 400);
    }

    const flight = await patchFlight(env, identity, patch);
    if (!flight) return json({ ok: false, error: "VOL INTROUVABLE" }, 404);
    return json({ ok: true, identity, flight });
  }

  if (url.pathname === "/api/flights/sync" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.flights)) return json({ ok: false, error: "LISTE VOLS MANQUANTE" }, 400);
    const count = await syncFlights(env, body.flights);
    return json({ ok: true, count });
  }

  if (url.pathname === "/api/flights" && request.method === "DELETE") {
    await env.OPS_DB.prepare("DELETE FROM flights").run();
    return json({ ok: true, cleared: true });
  }

  return null;
}
