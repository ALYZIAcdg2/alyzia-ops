// Petit magasin clé/valeur JSON pour la configuration de l'application
// (jetons OAuth Gmail/Drive, état d'intégration...). Porté verbatim depuis
// src/index.js v1 (ensurePrepaControlTables/getIntegrationJson/
// setIntegrationJson) — la création de table est maintenant centralisée
// dans ./schema.js (ensureSchema), plus besoin d'un ensure*Tables par
// fonctionnalité.

import { ensureSchema } from "./schema.js";

export async function getIntegrationJson(env, key) {
  await ensureSchema(env);
  const row = await env.OPS_DB.prepare(`
    SELECT value_json FROM app_integrations
    WHERE integration_key=?
    LIMIT 1
  `).bind(key).first();
  if (!row) return null;
  try {
    return JSON.parse(row.value_json || "{}");
  } catch (e) {
    return null;
  }
}

export async function setIntegrationJson(env, key, value) {
  await ensureSchema(env);
  await env.OPS_DB.prepare(`
    INSERT INTO app_integrations
      (integration_key,value_json,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(integration_key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(key, JSON.stringify(value || {})).run();
}
