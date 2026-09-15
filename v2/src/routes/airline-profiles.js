// Porté verbatim depuis src/index.js v1 (handleAirlineProfiles).

import { json } from "../lib/http.js";
import { isAuthorizedPrepa } from "./auth.js";
import { ensureAirlineProfile, getAirlineProfiles } from "../db/airline-profiles.js";
import { safeJsonParse } from "../lib/json.js";

function toProfileJson(row) {
  return {
    airline: String(row.airline || "").toUpperCase(),
    importMode: String(row.import_mode || "GENERIC").toUpperCase(),
    visibleKpis: safeJsonParse(row.visible_kpis_json, {}),
    visibleCards: safeJsonParse(row.visible_cards_json, {}),
    notesEnabled: Number(row.notes_enabled) !== 0,
    attachmentsEnabled: Number(row.attachments_enabled) !== 0,
    updatedAt: row.updated_at || "",
  };
}

export async function handleAirlineProfiles(request, env, url) {
  if (!url.pathname.startsWith("/api/airline-profiles")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  if (url.pathname === "/api/airline-profiles" && request.method === "GET") {
    const airline = String(url.searchParams.get("airline") || "").trim().toUpperCase();

    if (airline) {
      const row = await ensureAirlineProfile(env, airline);
      if (!row) return json({ ok: false, error: "COMPAGNIE INVALIDE" }, 400);
      return json({ ok: true, profile: toProfileJson(row) });
    }

    const profiles = await getAirlineProfiles(env);
    return json({ ok: true, count: profiles.length, profiles });
  }

  // Écriture protégée temporairement par ALYZIA_API_SECRET jusqu'à l'étape AUTH.
  if (url.pathname === "/api/airline-profiles" && request.method === "PATCH") {
    if (!isAuthorizedPrepa(request, env)) {
      return json({ ok: false, error: "NON AUTORISE" }, 401);
    }

    const body = await request.json().catch(() => null);
    const airline = String(body?.airline || "").trim().toUpperCase();
    if (!airline) return json({ ok: false, error: "COMPAGNIE MANQUANTE" }, 400);

    await ensureAirlineProfile(env, airline);

    const sets = [];
    const binds = [];

    if (body?.importMode !== undefined) {
      const mode = String(body.importMode || "").trim().toUpperCase();
      if (!["GENERIC", "SPECIFIC"].includes(mode)) {
        return json({ ok: false, error: "MODE IMPORT INVALIDE" }, 400);
      }
      sets.push("import_mode=?");
      binds.push(mode);
    }

    if (body?.visibleKpis !== undefined) {
      sets.push("visible_kpis_json=?");
      binds.push(JSON.stringify(body.visibleKpis || {}));
    }

    if (body?.visibleCards !== undefined) {
      sets.push("visible_cards_json=?");
      binds.push(JSON.stringify(body.visibleCards || {}));
    }

    if (body?.notesEnabled !== undefined) {
      sets.push("notes_enabled=?");
      binds.push(body.notesEnabled ? 1 : 0);
    }

    if (body?.attachmentsEnabled !== undefined) {
      sets.push("attachments_enabled=?");
      binds.push(body.attachmentsEnabled ? 1 : 0);
    }

    if (!sets.length) return json({ ok: false, error: "AUCUNE MODIFICATION" }, 400);

    sets.push("updated_at=CURRENT_TIMESTAMP");
    binds.push(airline);

    await env.OPS_DB.prepare(`
      UPDATE airline_profiles
      SET ${sets.join(", ")}
      WHERE airline=?
    `).bind(...binds).run();

    const row = await ensureAirlineProfile(env, airline);
    return json({ ok: true, profile: toProfileJson(row) });
  }

  return json({ ok: false, error: "ROUTE PROFIL COMPAGNIE INTROUVABLE" }, 404);
}
