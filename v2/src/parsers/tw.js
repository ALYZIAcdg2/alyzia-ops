// Parseur TW (t'way), porté verbatim depuis src/index.js v1.
//
// Corps de mail "CONTENT" : un flux dense continu, une réservation par
// passager (nom dupliqué, codes SSR sur plusieurs lignes, classe/sous-
// classe/statut/route/PNR/siège), jamais un tableau "LIST OF:" Altea.
// Format vérifié sur un vrai relevé TW402/06SEP réel (153/153 passagers
// extraits sans reste, comptage cabines C16/Y137 cohérent). TK utilise
// vraisemblablement le même format mais n'a pas encore été vérifié sur de
// vraies données : seule TW est activée ici.

export const TW_CONTENT_AIRLINES = new Set(["TW"]);

export function lot2TwNameAnchorRe() {
  return /(\d{1,4})\s+([A-Z][A-Z\s'\-]*?\s*\/\s*[A-Z][A-Z\s'\-]*?)\s\2(?=\s)/g;
}

export function lot2TwContentDetect(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!/\bCONTENT\b/.test(flat)) return "";
  const re = lot2TwNameAnchorRe();
  let count = 0;
  while (re.exec(flat)) {
    count++;
    if (count >= 3) break;
  }
  return count >= 3 ? "CONTENT" : "";
}

export function lot2TwExtractPassengerItems(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const re = lot2TwNameAnchorRe();
  const anchors = [];
  let m;
  while ((m = re.exec(flat))) anchors.push({ index: m.index, end: m.index + m[0].length, name: m[2].trim() });
  const items = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].end;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : flat.length;
    const tail = flat.slice(start, end).trim();
    const name = anchors[i].name;
    const gt = tail.match(/^([MF])\s+(MSTR|MISS|MRS|MR|MS)\s+(\S+)\s+/);
    let rest = tail,
      gender = "",
      title = "",
      ptype = "";
    if (gt) {
      gender = gt[1];
      title = gt[2];
      ptype = gt[3];
      rest = tail.slice(gt[0].length);
    }
    // Repère fixe du format : <CABINE> <SOUS-CLASSE> HK[ CK/BD...]  CDG ICN[ AÉROPORT][ TWxxxx]  <jambe>/<jambes> <PNR>[ SIÈGE]
    // "NULL" est une valeur littérale de champ vide dans une variante réelle
    // du format (vue sur un vrai mail TW402/31AOÛT après activation) : tous
    // les champs optionnels doivent aussi accepter ce jeton, sans quoi le
    // repère ne matche plus jamais et TOUS les passagers du document sont
    // silencieusement ignorés (extraction à 0 malgré un document valide).
    const core = rest.match(
      /\b(C|Y)\s+([A-Z]{1,2})\s+HK(?:\s+(?:CK|BD|NULL))*\s+CDG\s+ICN(?:\s+(?:([A-Z]{3})|NULL))?(?:\s+(?:(TW\d{2,4})|NULL))?\s+(\d\/\d)\s+([A-Z0-9]{6})(?:\s+NULL)?(?:\s+([0-9]{2}[A-Z]))?/
    );
    if (!core) continue; // repère absent : ligne non fiable, ignorée plutôt que de créer un passager corrompu
    const ssrBlock = rest.slice(0, core.index).trim();
    items.push({
      id: `TW-${i + 1}-${name}`,
      seq: i + 1,
      name,
      title,
      gender,
      passengerType: ptype || "ADULT",
      class: core[1],
      cabinClass: core[1],
      bookingClass: core[2],
      origin: "CDG",
      destination: core[3] || "ICN",
      seat: core[7] || "",
      pnr: core[6],
      legRatio: core[5],
      connectingFlight: core[4] || "",
      specific: "",
      note: "",
      listName: "TW CONTENT",
      cardKey: "MASTER",
      source: "TW_CONTENT",
      ssr: ssrBlock ? ssrBlock.split(/\s+/).filter((x) => x && x !== "NULL") : [],
    });
  }
  return items;
}

export function lot2TwClassCounts(items) {
  const out = {};
  for (const p of items || []) {
    const c = String(p.cabinClass || p.class || "").toUpperCase();
    if (!c) continue;
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}
