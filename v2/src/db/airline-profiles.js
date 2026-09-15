// Profils compagnie (mode d'import, cartes/KPI visibles, notes/pièces
// jointes activées). Porté verbatim depuis src/index.js v1.

import { ensureSchema } from "./schema.js";
import { safeJsonParse } from "../lib/json.js";

export function defaultImportModeForAirline(airline) {
  // Toutes les compagnies (SQ/TK/TW/BJ incluses) tournent maintenant en
  // GENERIC : plus aucune compagnie verrouillée sur un parseur SPECIFIC.
  return "GENERIC";
}

export async function ensureAirlineProfile(env, airline) {
  const code = String(airline || "").trim().toUpperCase();
  if (!code) return null;

  await ensureSchema(env);
  const mode = defaultImportModeForAirline(code);

  await env.OPS_DB.prepare(`
    INSERT OR IGNORE INTO airline_profiles
      (airline, import_mode, visible_kpis_json, visible_cards_json,
       notes_enabled, attachments_enabled, updated_at)
    VALUES (?, ?, '{}', '{}', 1, 1, CURRENT_TIMESTAMP)
  `).bind(code, mode).run();

  return await env.OPS_DB.prepare(`
    SELECT
      airline,
      import_mode,
      visible_kpis_json,
      visible_cards_json,
      notes_enabled,
      attachments_enabled,
      updated_at
    FROM airline_profiles
    WHERE airline=?
    LIMIT 1
  `).bind(code).first();
}

export async function getAirlineProfiles(env) {
  await ensureSchema(env);
  const { results = [] } = await env.OPS_DB.prepare(`
    SELECT
      airline,
      import_mode,
      visible_kpis_json,
      visible_cards_json,
      notes_enabled,
      attachments_enabled,
      updated_at
    FROM airline_profiles
    ORDER BY airline
  `).all();

  return results.map((row) => ({
    airline: String(row.airline || "").toUpperCase(),
    importMode: String(row.import_mode || "GENERIC").toUpperCase(),
    visibleKpis: safeJsonParse(row.visible_kpis_json, "{}"),
    visibleCards: safeJsonParse(row.visible_cards_json, "{}"),
    notesEnabled: Number(row.notes_enabled) !== 0,
    attachmentsEnabled: Number(row.attachments_enabled) !== 0,
    updatedAt: row.updated_at || "",
  }));
}
