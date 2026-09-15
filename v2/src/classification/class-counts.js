// Comptage des classes cabine à partir de l'en-tête "LIST OF:". Porté
// verbatim depuis src/index.js v1.
//
// Règle explicitement demandée par l'utilisateur : chaque compagnie garde
// ses vraies lettres de classe (ex. SK utilise "M" pour l'Économie, jamais
// "Y") — aucune conversion M→Y / J→C, quelle que soit la compagnie.

import { lot2Upper } from "../parsing/document-text.js";

export function lot2ExtractClassCounts(text) {
  // Ne jamais scanner tout le PDF : cela peut prendre "J274"/"J2809" pour
  // une classe J. Les classes viennent uniquement de l'en-tête LIST OF.
  // Exemple autorisé :
  //   LIST OF: FQA C0 Y14 TOTAL 14
  //   LIST OF: ONC C2 Y13 TOTAL 15
  const up = lot2Upper(text);
  const out = {};
  const header = up.match(/\bLIST\s+OF\s*:\s*[^\n\r]{0,220}/);
  if (!header) return out;

  const h = header[0];
  for (const m of h.matchAll(/\b([FJCWSYM])\s*(\d{1,4})\b/g)) {
    const k = m[1];
    const n = Number(m[2] || 0);
    if (Number.isFinite(n)) out[k] = (out[k] || 0) + n;
  }

  return out;
}

export function lot2PassengerClassFromCode(v) {
  const s = String(v || "").toUpperCase().trim();
  if (!s) return "";
  return s[0] || "";
}
