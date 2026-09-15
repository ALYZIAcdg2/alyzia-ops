// Parseur source IPORT (res2.iport.servers@res2.eu), compagnies IZ/TB.
// Porté verbatim depuis src/index.js v1.
//
// Format spécifique : corps mail texte brut, sans "LIST OF:", avec un
// en-tête "IZ742 06SEP CDG LIST TOTAL: 97Y", un nom de liste sur sa propre
// ligne (ALL PASSENGERS / CHILDREN / PASSENGERS WITH INFT / PASSENGERS
// CHECKED-IN VIA INTERNET / PIL BY SSR CATEGORY), un en-tête de colonnes
// puis des lignes préfixées par "---" ou un numéro de BCN, terminées par
// "END NAMES". Complètement distinct du pipeline Altea "LIST OF:" : ne
// touche à aucune compagnie déjà mappée.

import { lot2Upper } from "../parsing/document-text.js";

export const IPORT_AIRLINES = new Set(["IZ", "TB"]);

export const IPORT_LIST_LABELS = {
  ALL_PASSENGERS: "IPORT ALL PASSENGERS",
  CHILDREN: "IPORT CHILDREN",
  INFANTS: "IPORT PASSENGERS WITH INFT",
  WEB_CHECKIN: "IPORT PASSENGERS CHECKED-IN VIA INTERNET",
  PIL_SSR: "IPORT PIL BY SSR CATEGORY",
};

export const IPORT_LIST_CARD_KEYS = {
  ALL_PASSENGERS: "MASTER",
  CHILDREN: "CHLD",
  INFANTS: "INF",
  WEB_CHECKIN: "WEB",
  PIL_SSR: "IPORT_SSR",
};

export function lot2IportListKindFromBody(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const u = lot2Upper(line);
    if (/^ALL\s+PASSENGERS$/.test(u)) return "ALL_PASSENGERS";
    if (/^CHILDREN$/.test(u)) return "CHILDREN";
    if (/^PASSENGERS\s+WITH\s+INFT$/.test(u)) return "INFANTS";
    if (/^PASSENGERS\s+CHECKED-IN\s+VIA\s+INTERNET$/.test(u)) return "WEB_CHECKIN";
    if (/^PIL\s+BY\s+SSR\s+CATEGORY/.test(u)) return "PIL_SSR";
  }
  return "";
}

export function lot2IsIportBodyV1(text) {
  const t = String(text || "");
  if (!/\bLIST\s+TOTAL\s*:/i.test(t)) return false;
  return !!lot2IportListKindFromBody(t) || /^---\s/m.test(t) || /\bEND\s+NAMES\b/i.test(t);
}

export function lot2IportSplitNameAndRest(tail) {
  const t = String(tail || "");
  const m = t.match(/^([A-Z][A-Z'\-]*\/[A-Z][A-Z'\-]*)(.*)$/);
  if (!m) return null;
  let rest = m[2] || "";
  // Nom tronqué en largeur fixe et collé au champ suivant par un point
  // (ex. "SADOVNIKWEISS/LEONA.7F") au lieu d'un espace normal.
  rest = rest.replace(/^\./, " ");
  return { name: m[1], rest };
}

export function lot2IportPassengerType(pt) {
  const p = String(pt || "").toUpperCase();
  if (p.startsWith("I")) return "INF";
  if (p.startsWith("C")) return "CHLD";
  return "ADT";
}

export function lot2IportGender(pt) {
  const p = String(pt || "").toUpperCase();
  if (p.endsWith("F")) return "F";
  if (p.endsWith("M")) return "M";
  return "";
}

export function lot2IportParsePassengerRow(rawLine, kind) {
  const line = String(rawLine || "").trim();
  if (!line) return null;
  if (/^END\s+NAMES$/i.test(line)) return null;
  if (/^BCN\s+NAME\s+SEAT\b/i.test(line)) return null;
  const head = line.match(/^(---|\d{1,6})\s+(.+)$/);
  if (!head) return null;
  const bcn = head[1] === "---" ? "" : head[1];
  const n1 = lot2IportSplitNameAndRest(head[2]);
  if (!n1) return null;
  const name = n1.name;
  let rest = n1.rest.trim();
  let seat = "";
  const seatMatch = rest.match(/^(\d{1,2}[A-Z])\s+(.*)$/);
  if (seatMatch) {
    seat = seatMatch[1];
    rest = seatMatch[2];
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  const cc = tokens.shift() || "";
  const pt = tokens.shift() || "";
  const des = tokens.shift() || "";
  const st = tokens.shift() || "";
  let parentName = "",
    infDob = "";
  if (kind === "INFANTS") {
    const tail = tokens.join(" ");
    const n2 = lot2IportSplitNameAndRest(tail);
    if (n2) {
      parentName = n2.name;
      const dobMatch = n2.rest.trim().match(/^(\d{1,2}[A-Z]{3}\d{2,4})/);
      infDob = dobMatch ? dobMatch[1] : n2.rest.trim();
    } else {
      // Nom du parent tronqué en largeur fixe au point de perdre jusqu'au
      // séparateur "/" lui-même (ex. "MARCIANOSMA.26JAN26", sans "/" du tout) :
      // le nom seul ne matche plus lot2IportSplitNameAndRest, mais la date de
      // naissance en fin de champ reste récupérable. Sans ce repli, tout
      // (nom du parent ET date) était silencieusement perdu.
      const dobMatch = tail.match(/(\d{1,2}[A-Z]{3}\d{2,4})\s*$/);
      if (dobMatch) {
        infDob = dobMatch[1];
        parentName = tail.slice(0, dobMatch.index).replace(/\.$/, "").trim();
      }
    }
    tokens.length = 0;
  }
  return { bcn, name, seat, cc, pt, des, st, parentName, infDob, extra: tokens.join(" ") };
}

export function lot2IportBuildItem(row, kind, seq) {
  const cKey = IPORT_LIST_CARD_KEYS[kind] || "OTHER";
  const passengerType = lot2IportPassengerType(row.pt);
  const item = {
    id: `IPORT-${cKey}-${seq}-${row.name}`,
    seq,
    name: row.name,
    title: "",
    gender: lot2IportGender(row.pt),
    passengerType,
    class: row.cc,
    cabinClass: row.cc,
    origin: "",
    destination: row.des,
    acceptance: row.st,
    seat: row.seat,
    specific: "",
    note: "",
    listName: IPORT_LIST_LABELS[kind] || kind,
    cardKey: cKey,
    source: "IPORT_TEXT",
    ssr: [],
    bcn: row.bcn,
  };
  if (kind === "CHILDREN") {
    item.ssr = ["CHLD"];
    item.note = row.extra;
  } else if (kind === "INFANTS") {
    item.ssr = ["INF"];
    item.parentName = row.parentName;
    item.infantDob = row.infDob;
    item.note = [row.parentName ? `Parent ${row.parentName}` : "", row.infDob ? `DOB ${row.infDob}` : ""].filter(Boolean).join(" · ");
  } else if (kind === "WEB_CHECKIN") {
    item.status = "WEB";
    item.note = row.extra;
  } else {
    item.note = row.extra;
  }
  return item;
}

const IPORT_SSR_SECTION_TARGET = { MEALS: "MEAL", MEDICAL: "WCH", SEATS: "OTHER", OTHER: "OTHER" };

export function lot2IportExtractSsrItems(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/);
  const items = [];
  let section = "";
  let seq = 0;
  for (const raw of lines) {
    const trimmed = String(raw || "").trim();
    const sectionMatch = trimmed.match(/^\*-\*-\*-\*-\*-\*\s+([A-Z]+)\s+\*-\*-\*-\*-\*-\*$/i);
    if (sectionMatch) {
      section = sectionMatch[1].toUpperCase();
      continue;
    }
    if (!section) continue;
    if (/^SEAT\s+NAME\s+PT\s+DES\s+SSR$/i.test(trimmed)) continue;
    if (/^NO\s+(MEALS|SEATS)$/i.test(trimmed)) continue;
    const m = trimmed.match(/^(\d{1,2}[A-Z])\s+(.+?)\s+([A-Z]{2})\s+([A-Z]{3})\s+(\S+)(.*)$/);
    if (!m) continue;
    const seat = m[1];
    const name = m[2];
    const pt = m[3];
    const des = m[4];
    const ssrCode = m[5].replace(/\.$/, "");
    const tailText = String(m[6] || "").trim();
    // YCTC/IZIT ne sont pas des SSR d'assistance : ce sont des confirmations
    // internes de siège payant (bruit commercial), à ne jamais mettre dans la fiche.
    if (/^(YCTC|IZIT)/i.test(ssrCode)) continue;
    const target = IPORT_SSR_SECTION_TARGET[section] || "OTHER";
    seq++;
    items.push({
      id: `IPORT-SSR-${seq}-${name}`,
      seq,
      name,
      title: "",
      gender: lot2IportGender(pt),
      passengerType: lot2IportPassengerType(pt),
      class: "",
      cabinClass: "",
      origin: "",
      destination: des,
      acceptance: "",
      seat,
      specific: ssrCode,
      category: ssrCode,
      note: tailText,
      listName: IPORT_LIST_LABELS.PIL_SSR,
      cardKey: "IPORT_SSR",
      source: "IPORT_TEXT",
      ssr: [ssrCode],
      iportSection: target,
    });
  }
  return items;
}

export function lot2IportExtractPassengerItems(text, kind) {
  if (kind === "PIL_SSR") return lot2IportExtractSsrItems(text);
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/);
  const items = [];
  let seq = 0;
  for (const raw of lines) {
    const row = lot2IportParsePassengerRow(raw, kind);
    if (!row) continue;
    seq++;
    items.push(lot2IportBuildItem(row, kind, seq));
  }
  return items;
}

export function lot2IportClassCounts(items) {
  const out = {};
  for (const p of items || []) {
    const c = String(p.class || p.cabinClass || "").toUpperCase();
    if (!c) continue;
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}
