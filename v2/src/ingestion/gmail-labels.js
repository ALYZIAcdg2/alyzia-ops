// Gestion des étiquettes Gmail (statut du pipeline par mail, une étiquette
// par compagnie détectée). Porté verbatim depuis src/index.js v1.

import { gmailFetch } from "./gmail-client.js";

export const GMAIL_LABELS = {
  RECEIVED: "ALYZIA/REÇU",
  IMPORTED: "ALYZIA/IMPORTÉ",
  INJECTED: "ALYZIA/INJECTÉ",
  VALIDATED: "ALYZIA/VALIDÉ",
  REVIEW: "ALYZIA/À_REVOIR",
  DUPLICATE: "ALYZIA/IGNORÉ_DOUBLON",
  ERROR: "ALYZIA/ERREUR",
  ERROR_IMPORT: "ALYZIA/ERREUR IMPORT",
  ERROR_INJECT: "ALYZIA/ERREUR INJECTE",
  UPDATED: "ALYZIA/MIS_A_JOUR", // ancien libellé : retiré lors d'une transition V5.3
  SUPPRESSED: "ALYZIA/SUPPRIMÉ_NEUTRALISÉ",
};

export const GMAIL_PIPELINE_STATE_KEYS = new Set([
  "RECEIVED", "IMPORTED", "INJECTED", "VALIDATED", "REVIEW", "DUPLICATE", "ERROR", "ERROR_IMPORT", "ERROR_INJECT",
]);

export const CLEAN_LABEL_SUFFIX = {
  RECEIVED: "MAIL TRAITÉ",
  IMPORTED: "IMPORTÉ",
  INJECTED: "FICHE VOL OK",
  VALIDATED: "FICHE VOL OK",
  REVIEW: "ERREUR",
  DUPLICATE: "IGNORÉ_DOUBLON",
  ERROR: "ERREUR",
  ERROR_IMPORT: "ERREUR",
  ERROR_INJECT: "ERREUR",
};

export const CLEAN_LABEL_COLORS = {
  // Demande utilisateur : ERREUR rouge / TRAITÉ jaune / FICHE OK vert.
  "MAIL TRAITÉ": { backgroundColor: "#fad165", textColor: "#000000" },
  IMPORTÉ: { backgroundColor: "#ffad46", textColor: "#000000" },
  "FICHE VOL OK": { backgroundColor: "#16a766", textColor: "#ffffff" },
  ERREUR: { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  IGNORÉ_DOUBLON: { backgroundColor: "#fad165", textColor: "#000000" },
};

export function cleanAirlineCodeV1(v) {
  const x = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2}$/.test(x) && !/^\d{2}$/.test(x) ? x : "INCONNU";
}

export function cleanStatusLabelNameV1(airline, state) {
  const suffix = CLEAN_LABEL_SUFFIX[String(state || "").toUpperCase()] || "ERREUR";
  return `ALYZIA/${cleanAirlineCodeV1(airline)}/${suffix}`;
}

let gmailLabelIdCache = null;

export async function applyCleanLabelColorV1(env, labelId, suffix) {
  const color = CLEAN_LABEL_COLORS[suffix];
  if (!labelId || !color) return;
  await gmailFetch(env, `/labels/${encodeURIComponent(labelId)}`, { method: "PATCH", body: JSON.stringify({ color }) }).catch(() => {});
}

export async function ensureGmailLabel(env, name) {
  if (gmailLabelIdCache?.has(name)) return gmailLabelIdCache.get(name);
  const labels = await gmailFetch(env, "/labels");
  gmailLabelIdCache = new Map((labels.labels || []).map((l) => [String(l.name || ""), String(l.id || "")]));
  const found = gmailLabelIdCache.get(name);
  if (found) return found;
  const created = await gmailFetch(env, "/labels", { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
  if (created?.id) {
    gmailLabelIdCache.set(name, String(created.id));
    const suffix = String(name || "").split("/").pop();
    await applyCleanLabelColorV1(env, String(created.id), suffix).catch(() => {});
  }
  return created.id;
}

export async function applyGmailLabel(env, messageId, labelName) {
  if (!messageId || !labelName) return;
  const labelId = await ensureGmailLabel(env, labelName);
  await gmailFetch(env, `/messages/${encodeURIComponent(messageId)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [labelId] }) });
}

export async function setGmailPipelineState(env, messageId, state, { archive = true } = {}) {
  const key = String(state || "").toUpperCase();
  if (!messageId || !GMAIL_PIPELINE_STATE_KEYS.has(key)) return;
  if (!gmailLabelIdCache) {
    const labels = await gmailFetch(env, "/labels");
    gmailLabelIdCache = new Map((labels.labels || []).map((x) => [String(x.name || ""), String(x.id || "")]));
  }
  const gm = await env.OPS_DB.prepare(`SELECT airline FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first().catch(() => null);
  const airline = cleanAirlineCodeV1(gm?.airline || "");
  const desiredName = cleanStatusLabelNameV1(airline, key);
  let desiredId = gmailLabelIdCache.get(desiredName) || "";
  if (!desiredId) {
    desiredId = await ensureGmailLabel(env, desiredName);
    gmailLabelIdCache.set(desiredName, desiredId);
  }

  // Remove only ALYZIA processing-status labels (old global scheme + new company scheme).
  const suffixes = new Set(Object.values(CLEAN_LABEL_SUFFIX));
  const removeIds = [];
  for (const [name, id] of gmailLabelIdCache.entries()) {
    if (!id || name === desiredName) continue;
    const oldGlobal = Object.values(GMAIL_LABELS).includes(name);
    const p = String(name).split("/");
    const cleanCompany = name.startsWith("ALYZIA/") && p.length >= 3 && suffixes.has(p[p.length - 1]);
    if (oldGlobal || cleanCompany) removeIds.push(id);
  }
  if (archive && key !== "RECEIVED") removeIds.push("INBOX");
  const uniqueRemove = [...new Set(removeIds)].filter((id) => id && id !== desiredId);
  await gmailFetch(env, `/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: [desiredId], removeLabelIds: uniqueRemove }),
  });
  await env.OPS_DB.prepare(`UPDATE gmail_messages SET status=?,label_state=?,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(key, key, messageId).run().catch(() => {});
}

export async function clearAlyziaPipelineLabels(env, messageId) {
  if (!messageId) return;
  if (!gmailLabelIdCache) {
    const labels = await gmailFetch(env, "/labels");
    gmailLabelIdCache = new Map((labels.labels || []).map((x) => [String(x.name || ""), String(x.id || "")]));
  }
  const suffixes = new Set(Object.values(CLEAN_LABEL_SUFFIX));
  const remove = [];
  for (const [name, id] of gmailLabelIdCache.entries()) {
    const oldGlobal = Object.values(GMAIL_LABELS).includes(name);
    const p = String(name).split("/");
    const cleanCompany = name.startsWith("ALYZIA/") && p.length >= 3 && suffixes.has(p[p.length - 1]);
    if ((oldGlobal || cleanCompany) && id) remove.push(id);
  }
  if (remove.length) await gmailFetch(env, `/messages/${encodeURIComponent(messageId)}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: [...new Set(remove)] }) });
}
