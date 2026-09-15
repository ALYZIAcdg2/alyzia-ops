// Parseur TK (Turkish Airlines), porté verbatim depuis src/index.js v1.
//
// Corps de mail texte, plusieurs sections dans le MÊME document (CHECK IN
// INFORMATION, TOY'S R US, REBATE PAX, ONCARRIAGE PAX, EMD/E-TKT/FQTV FULL
// LIST, ALL PAX, ...), chaque section terminée par "END NAMES". Format
// vérifié sur 3 vrais mails réels (.eml fournis par l'utilisateur, décodés
// proprement — base64 et quoted-printable) : "ALL PAX" est le manifeste
// complet ligne par ligne (nom tronqué + destination/classe/siège/eticket,
// puis une ligne détail "SURNAME-GIVEN-TYPE-TITLE"). Sur le mail complet
// non tronqué (TK1830/28AUG) : 160/160 passagers extraits, comptage cabine
// C20/Y140 EXACT par rapport à l'en-tête "0 F 20 C 140Y". Les autres
// sections ne sont volontairement pas parsées ici (redondantes avec ALL
// PAX, comme les CC-x de SQ) : seule ALL PAX construit la fiche, le reste
// tombe en repli générique sans dégât (cardKey OTHER déjà ignoré ailleurs).

export const TK_ALLPAX_AIRLINES = new Set(["TK"]);

export function lot2TkAllPaxHeaderMatch(text) {
  return String(text || "").match(/\b[A-Z]{2}\d{2,4}\s+\d{1,2}[A-Z]{3}\s+\w{3}\s+ALL PAX\s+(\d+)\s+F\s+(\d+)\s+C\s+(\d+)\s*Y/);
}

export function lot2TkContentDetect(text) {
  const m = lot2TkAllPaxHeaderMatch(text);
  if (!m) return "";
  const total = Number(m[1] || 0) + Number(m[2] || 0) + Number(m[3] || 0);
  return total > 0 ? "ALL_PAX" : "";
}

export function lot2TkExtractPassengerItems(text) {
  const flat = String(text || "");
  const m = lot2TkAllPaxHeaderMatch(flat);
  if (!m) return [];
  const after = flat.slice(m.index + m[0].length);
  const endIdx = after.indexOf("END NAMES");
  const section = endIdx >= 0 ? after.slice(0, endIdx) : after;
  const lines = section.replace(/\r/g, "").split("\n");
  const records = [];
  let current = null;
  for (const line of lines) {
    const numMatch = line.match(/^\s*(\d{1,3})\.(.*)$/);
    if (numMatch) {
      if (current) records.push(current);
      current = { seq: Number(numMatch[1]), lines: [numMatch[2]] };
    } else if (current && line.trim()) {
      current.lines.push(line);
    }
  }
  if (current) records.push(current);

  const items = [];
  for (const r of records) {
    const l1 = r.lines[0] || "";
    // Le champ nom tronqué colle parfois l'initiale avec "!" sans espace
    // (ex. "AGBADAMU!J") au lieu de "ADAMS    J" : peu importe, le vrai nom
    // vient de la ligne 2 détail. On cherche juste IST (toujours présent
    // pour ces vols CDG-IST) pour repartir sur la classe et le reste.
    const m1 = l1.match(/\bIST\s+([FCY])\s*(.*)$/);
    let cls = "",
      rest1 = "";
    if (m1) {
      cls = m1[1];
      rest1 = m1[2];
    }
    const etktMatch = rest1.match(/(\d{10,14}[A-Z]\d)/);
    const etkt = etktMatch ? etktMatch[1] : "";
    const seatMatch = rest1.match(/(\d{2,3}[A-Z]?(?:-[A-Z])?)\s+[FM]?\s*\d\s+\d{10,14}[A-Z]\d/);
    const seat = seatMatch ? seatMatch[1] : "";
    const l2 = (r.lines[1] || "").trim();
    const m2 = l2.match(/^([A-Z][A-Z' ]*?)\s*-\s*([A-Z][A-Z' ]*?)\s*-\s*(\w*)\s*-\s*(\w*)\s*$/);
    if (!m2) continue; // ligne détail absente/illisible : ignorée plutôt que de créer un passager sans nom fiable
    const surname = m2[1].trim(),
      given = m2[2].trim(),
      ptype = m2[3].trim(),
      title = m2[4].trim();
    items.push({
      id: `TK-${r.seq}-${surname}/${given}`,
      seq: r.seq,
      name: `${surname}/${given}`,
      title,
      gender: "",
      passengerType: ptype === "CHD" ? "CHD" : ptype || "ADT",
      class: cls,
      cabinClass: cls,
      seat,
      etkt,
      origin: "CDG",
      destination: "IST",
      specific: "",
      note: "",
      listName: "TK ALL PAX",
      cardKey: "MASTER",
      source: "TK_ALLPAX",
      ssr: [],
    });
  }
  return items;
}

export function lot2TkClassCounts(items) {
  const out = {};
  for (const p of items || []) {
    const c = String(p.cabinClass || p.class || "").toUpperCase();
    if (!c) continue;
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}
