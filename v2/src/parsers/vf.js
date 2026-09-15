// Parseur VF (AJet), porté verbatim depuis src/index.js v1.
//
// Format PD4ML propre à VF : "ALL Reservetion List" / "Check-In List
// Boarded" / "Eticket List" / "Outbound Summary List" / "SSR List", avec un
// en-tête "DD/Mon/YYYY VF## ORG - DST" (même famille que BJ, traité
// indépendamment). Chaque champ d'un passager est sur sa propre ligne dans
// le flux texte extrait (une valeur par ligne, ordre de colonnes variable
// selon la liste), donc l'extraction se fait par RECONNAISSANCE DE FORME de
// chaque ligne plutôt que par position fixe. Indépendant du pipeline Altea
// "LIST OF:" et du parser BJ verrouillé.
//
// Inclut les corrections validées cette session sur de vrais PDF BJ :
// - FQTV : le niveau de carte ("WHITE") ne doit pas être lu comme un second
//   passager (cardTier + garde dans lot2VfScanRecords).
// - STAFF ("PASS2 PRINT") : titre non reconnu à l'origine, ajouté.
// - Check-In List Boarded : en-têtes tout en majuscules ("TKNE","C STS",
//   "B. STS") non filtrés à l'origine, pris pour un nom de passager.

import { lot2Upper } from "../parsing/document-text.js";
import { lot2PassengerClassFromCode } from "../classification/class-counts.js";

export const VF_LIST_LABELS = {
  RESERVATION: "VF ALL RESERVATION LIST",
  CHECKIN: "VF CHECK-IN LIST BOARDED",
  ETICKET: "VF ETICKET LIST",
  OUTBOUND_SUMMARY: "VF OUTBOUND SUMMARY LIST",
  SSR: "VF SSR LIST",
  FQTV: "VF FQTV LIST",
  INFANT: "VF PASSENGER WITH INFANT LIST",
  OUTBOUND_DETAILS: "VF OUTBOUND PASSENGER DETAILS LIST",
  INBOUND_DETAILS: "VF INBOUND PASSENGER DETAILS LIST",
  CHLD: "VF CHILD LIST",
  STAFF: "VF PASS2 STAFF LIST",
};

export const VF_LIST_CARD_KEYS = {
  RESERVATION: "MASTER",
  CHECKIN: "BOARDED",
  ETICKET: "ETKT",
  OUTBOUND_SUMMARY: "OUTBOUND_SUMMARY",
  SSR: "SSR",
  FQTV: "FQTV",
  // cardKey "INF" (pas "INFANT") : c'est le littéral attendu partout ailleurs
  // dans le pipeline générique (lot3MergeFlightData, lot3NormalizePassengerForUi,
  // split INFKID...).
  INFANT: "INF",
  OUTBOUND_DETAILS: "OUTBOUND",
  INBOUND_DETAILS: "INBOUND",
  CHLD: "CHLD",
  STAFF: "STAFF",
};

// Codes SSR "repas" repérés dans la vraie liste SSR VF (confirmés un par un
// contre un vrai PDF SSR List : "BDML : BDML-BUNDLE S" = sandwich, sans texte
// CATERING contrairement à CPDR/DSML/EBML qui portent tous "CATERING").
export const VF_MEAL_SSR_CODES = new Set(["BDML", "CPDR", "DSML", "EBML"]);

export const VF_HEADER_WORDS = new Set([
  "NO", "SURNAME", "NAME", "GC", "PNR", "STATUS", "OWNER", "TICKET", "FLIGHT",
  "FROM", "TO", "INV", "VOL", "DOS", "CC", "SEAT", "SEQ", "BAG", "DIFF", "STS",
  "EXPLANATION", "HAS", "CBAG", "TK_NO", "INBOUND", "PAYMENT", "SSR", "VF", "BJ",
  "MAIN", "CI", "OUT", "RES", "TOTAL", "CBBG", "EXST", "PC", "WEIGHT", "END", "LIST",
  // Colonnes propres à FQTV List et Passenger With Infant.
  "GENDER", "FFID", "BONUS POINTS", "TIER POINTS", "CARD TYPE",
  "G", "INFANT", "INFANT SURNAME", "INFANT NAME", "INFANT DOB", "C.S",
  // Colonnes à ignorer explicitement dans SSR List.
  "PAYMENT STATUS", "CABIN", "CLASS", "CPN", "CPN STATUS",
  // En-têtes de colonnes imprimés TOUT EN MAJUSCULES dans le PDF réel : sans
  // eux, le premier passager après ces en-têtes est pris à tort pour un nom
  // (ex. "B. STS/FOURNIER" observé sur un vrai Check-In List Boarded BJ).
  "TKNE", "C STS", "B. STS",
]);

export function lot2VfListKindFromText(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const title = lot2Upper(lines[0] || "");
  if (/^ALL\s+RESERVETION\s+LIST$/.test(title)) return "RESERVATION";
  if (/^CHECK-?IN\s+LIST\s+BOARDED$/.test(title)) return "CHECKIN";
  if (/^ETICKET\s+LIST$/.test(title)) return "ETICKET";
  if (/^OUTBOUND\s+SUMMARY\s+LIST$/.test(title)) return "OUTBOUND_SUMMARY";
  if (/^SSR\s+LIST$/.test(title)) return "SSR";
  if (/^FQTV\s+LIST$/.test(title)) return "FQTV";
  if (/^PASSENGER\s+WITH\s+INFANT$/.test(title)) return "INFANT";
  if (/^OUTBOUND\s+PASSENGER\s+DETAILS\s+LIST$/.test(title)) return "OUTBOUND_DETAILS";
  if (/^INBOUND\s+PASSENGER\s+DETAILS\s+LIST$/.test(title)) return "INBOUND_DETAILS";
  if (/^CHILD\s+LIST$/.test(title)) return "CHLD";
  // "PASS2 PRINT" (BJ) : liste du personnel/voyageurs à tarif réduit (ID/staff).
  if (/^PASS2\s+PRINT$/.test(title)) return "STAFF";
  return "";
}

export function lot2VfExtractRoute(text) {
  // Connaître précisément les deux seuls codes aéroport valides du document :
  // sans ça, un nom de famille de 3 lettres (ex. "BAS") est indiscernable
  // d'un code aéroport générique et casse l'alignement des champs suivants.
  const m = String(text || "").match(
    /\b(\d{1,2})\/(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(20\d{2})\s+(?:BJ|VF)\s*\d{1,4}\s+([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/i
  );
  return m ? { origin: m[3].toUpperCase(), destination: m[4].toUpperCase() } : { origin: "", destination: "" };
}

export function lot2VfClassifyToken(raw, route) {
  const t = String(raw || "").trim();
  if (!t) return { type: "skip" };
  const u = t.toUpperCase();
  if (VF_HEADER_WORDS.has(u)) return { type: "skip" };
  if (route && (u === route.origin || u === route.destination)) return { type: "airport", value: u };
  if (/^\d{2}:\d{2}:\d{2}$/.test(u)) return { type: "skip" };
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(u)) return { type: "skip" };
  // Lignes SSR ("CBAG : CBAG- 8KG CAB", "FQTV : TK204054333 T", ...).
  const ssrM = t.match(/^([A-Z][A-Z0-9]{1,7})\s*:\s*(.+)$/);
  if (ssrM) return { type: "ssr", code: ssrM[1].toUpperCase(), text: ssrM[2].trim() };
  if (/^\d{1,2}$/.test(u)) return { type: "skip" }; // numéro de ligne ("No")
  if (/^\d{10,13}$/.test(u)) return { type: "ticket", value: u };
  // Child List porte le numéro de coupon accolé au billet (".../1", ".../3") :
  // on garde uniquement le numéro de billet, le coupon n'est pas exploité ici.
  if (/^\d{10,13}\/\d{1,2}$/.test(u)) return { type: "ticket", value: u.split("/")[0] };
  // PNR à 6 caractères, toujours préfixé d'un chiffre dans ce système
  // (contrairement à un nom de famille pur-lettres qui peut aussi faire 6 caractères).
  if (/^[0-9][A-Z0-9]{5}$/.test(u)) return { type: "pnr", value: u };
  if (/^\d{1,2}[A-Z]$/.test(u)) return { type: "seat", value: u };
  // Numéro FQTV (FFID) : 2 lettres + 9 chiffres ("TK463971137"), propre à la
  // liste FQTV. Sur un vrai FQTV List BJ, ce champ porte parfois le niveau de
  // carte accolé par un point ("BJ194362534.WHITE") : capturé à part (voir
  // lot2VfScanRecords, qui l'utilise aussi pour ignorer le "WHITE" isolé qui
  // suit sur sa propre ligne — sinon pris à tort pour un second passager et
  // cassant tout l'alignement).
  const ffidM = u.match(/^([A-Z]{2}\d{9})(?:\.([A-Z]+))?$/);
  if (ffidM) return { type: "ffid", value: ffidM[1], tier: ffidM[2] || "" };
  // "YES"/"NO" (colonne "**Has Cbag" de Check-In List Boarded) ressemblent à un
  // code classe (Y+2 caractères) mais n'en sont pas : à exclure explicitement.
  if (u === "YES" || u === "NO") return { type: "skip" };
  if (/^Y[A-Z0-9]{1,2}$/.test(u)) return { type: "class", value: u };
  if (/^[A-Z]{2}$/.test(u)) return { type: "skip" }; // statut vol / code 2 lettres bruit
  // Code groupe (GC, ex. "A1","D32") : plusieurs passagers d'un même PNR
  // partagent ce code. Capturé pour permettre la recherche par groupe.
  if (/^[A-Z]{1,2}\d{1,3}$/.test(u)) return { type: "groupcode", value: u };
  if (/^(?:TK|CX|OP|1[A-Z])?\s*TICKET$/i.test(t)) return { type: "skip" };
  if (/^[A-Z][A-Z .'-]*$/.test(t) && t.length >= 2) return { type: "name", value: t.replace(/\s+/g, " ").trim() };
  return { type: "skip" };
}

export function lot2VfScanRecords(text) {
  const route = lot2VfExtractRoute(text);
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/);
  const records = [];
  let cur = null;
  const fresh = (surname) => ({ surname, name: undefined, pnr: "", ticket: "", seat: "", cls: "", ssr: [], ffid: "", cardTier: "", groupCode: "" });
  for (const raw of lines) {
    const tok = lot2VfClassifyToken(raw, route);
    if (tok.type === "name") {
      // Sur un vrai FQTV List BJ, le niveau de carte ("WHITE") apparaît une
      // deuxième fois, seul sur sa propre ligne, juste après le jeton FFID
      // ("BJ194362534.WHITE") qui le porte déjà : sans ce garde-fou, il est
      // pris pour un second passager et décale tous les enregistrements
      // suivants (19 "passagers" extraits au lieu des 13 réels).
      if (cur && cur.cardTier && tok.value.toUpperCase() === cur.cardTier) continue;
      if (!cur) cur = fresh(tok.value);
      else if (cur.surname === undefined) cur.surname = tok.value;
      else if (cur.name === undefined) cur.name = tok.value;
      else {
        records.push(cur);
        cur = fresh(tok.value);
      }
    } else if (cur) {
      if (tok.type === "pnr") cur.pnr = tok.value;
      else if (tok.type === "ticket") cur.ticket = tok.value;
      else if (tok.type === "seat") cur.seat = tok.value;
      else if (tok.type === "class") cur.cls = tok.value;
      else if (tok.type === "ssr") cur.ssr.push({ code: tok.code, text: tok.text });
      else if (tok.type === "ffid") {
        cur.ffid = tok.value;
        if (tok.tier) cur.cardTier = tok.tier;
      } else if (tok.type === "groupcode") cur.groupCode = tok.value;
    }
  }
  if (cur && cur.surname !== undefined && cur.name !== undefined) records.push(cur);
  return records.filter((r) => r.surname && r.name);
}

export function lot2VfBuildItem(rec, kind, seq) {
  const cKey = VF_LIST_CARD_KEYS[kind] || "OTHER";
  // La classe cabine affichée/comptée reste la lettre seule ("Y"), comme pour
  // le pipeline Altea générique (lot2PassengerClassFromCode) : le code
  // tarifaire brut ("YL","Y2"...) est conservé à part dans "acceptance",
  // jamais dans class/cabinClass.
  const cabinClass = lot2PassengerClassFromCode(rec.cls);
  const item = {
    id: `VF-${cKey}-${seq}-${rec.surname}-${rec.name}`,
    seq,
    name: `${rec.surname}/${rec.name}`,
    title: "",
    gender: "",
    passengerType: kind === "CHLD" ? "CHLD" : "ADT",
    class: cabinClass,
    cabinClass: cabinClass,
    origin: "",
    destination: "",
    acceptance: rec.cls,
    seat: rec.seat,
    specific: "",
    note: "",
    listName: VF_LIST_LABELS[kind] || kind,
    cardKey: cKey,
    source: "VF_PD4ML",
    ssr: [],
    pnr: rec.pnr,
    etkt: rec.ticket,
    documentNumber: rec.ticket,
    groupCode: rec.groupCode || "",
  };
  if (kind === "SSR") {
    item.ssr = rec.ssr.map((s) => s.code);
    item.note = rec.ssr.map((s) => `${s.code}: ${s.text}`).join(" · ");
  }
  if (kind === "FQTV" && rec.ffid) {
    // lot3NormalizePassengerForUi construit déjà x.fqtv.number depuis x.ffid
    // pour cardKey FQTV : pas besoin de dupliquer dans etkt/documentNumber.
    item.ffid = rec.ffid;
    // Niveau de carte réel ("WHITE"...) plutôt que le repli générique "FQA".
    if (rec.cardTier) item.category = rec.cardTier;
  }
  return item;
}

// Passenger With Infant a une structure différente des autres listes VF :
// chaque enregistrement porte DEUX identités consécutives (adulte puis
// bébé), et non un simple couple nom/prénom. Le classifieur générique
// (lot2VfClassifyToken/lot2VfScanRecords) ne peut pas s'y appliquer tel
// quel : il compterait 4 "name" par ligne et casserait l'alignement.
// On utilise donc un scanner dédié, avec la lettre de genre (F/M, seule
// sur sa ligne) comme marqueur de bascule adulte → bébé.
export function lot2VfClassifyInfantToken(raw, route) {
  const t = String(raw || "").trim();
  if (!t) return { type: "skip" };
  const u = t.toUpperCase();
  if (VF_HEADER_WORDS.has(u)) return { type: "skip" };
  if (/^[FM]$/.test(u)) return { type: "gender" };
  if (route && (u === route.origin || u === route.destination)) return { type: "airport", value: u };
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(u)) return { type: "dob", value: u };
  if (/^Y[A-Z0-9]{1,2}$/.test(u)) return { type: "class", value: u };
  if (/^\d{1,2}$/.test(u)) return { type: "skip" };
  if (/^[A-Z]{2}$/.test(u)) return { type: "skip" };
  if (/^[A-Z][A-Z .'-]*$/.test(t) && t.length >= 2) return { type: "name", value: t.replace(/\s+/g, " ").trim() };
  return { type: "skip" };
}

export function lot2VfScanInfantRecords(text) {
  const route = lot2VfExtractRoute(text);
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/);
  const records = [];
  let cur = null;
  const fresh = () => ({ surname: undefined, name: undefined, infantSurname: undefined, infantName: undefined, infantDob: "", cls: "" });
  const adultDone = (r) => r.surname !== undefined && r.name !== undefined;
  const recordDone = (r) => adultDone(r) && r.infantSurname !== undefined && r.infantName !== undefined;
  // Le document réel n'affiche pas de lettre de genre entre le couple
  // adulte et le couple bébé (vérifié sur un PDF réel) : la bascule se
  // fait donc sur l'état des champs déjà remplis (2 noms = adulte, puis
  // 2 noms suivants = bébé), pas sur un jeton "genre" qui n'existe pas
  // toujours dans le flux.
  for (const raw of lines) {
    const tok = lot2VfClassifyInfantToken(raw, route);
    if (tok.type === "name") {
      if (!cur || recordDone(cur)) {
        if (cur) records.push(cur);
        cur = fresh();
      }
      if (!adultDone(cur)) {
        if (cur.surname === undefined) cur.surname = tok.value;
        else cur.name = tok.value;
      } else {
        if (cur.infantSurname === undefined) cur.infantSurname = tok.value;
        else cur.infantName = tok.value;
      }
    } else if (cur) {
      if (tok.type === "dob") cur.infantDob = tok.value;
      else if (tok.type === "class") cur.cls = tok.value;
    }
  }
  if (cur && cur.surname !== undefined && cur.name !== undefined) records.push(cur);
  return records.filter((r) => r.surname && r.name);
}

export function lot2VfBuildInfantItem(rec, seq) {
  const hasInfant = Boolean(rec.infantSurname && rec.infantName);
  const parentName = `${rec.surname}/${rec.name}`;
  const infantName = hasInfant ? `${rec.infantSurname}/${rec.infantName}` : "";
  const cabinClass = lot2PassengerClassFromCode(rec.cls);
  return {
    // Le nom affiché dans la LISTE doit être celui du BÉBÉ, pas du parent :
    // avec le nom du parent, la recherche de passager rapprocherait cette
    // ligne du dossier MASTER du même adulte (déjà réservé en tant que
    // passager), donnant l'impression d'un doublon du parent.
    id: `VF-INFANT-${seq}-${rec.surname}-${rec.name}`,
    seq,
    name: hasInfant ? infantName : parentName,
    title: "",
    gender: "",
    passengerType: "INF",
    class: cabinClass,
    cabinClass: cabinClass,
    origin: "",
    destination: "",
    acceptance: rec.cls,
    seat: "",
    specific: `PARENT: ${parentName}`,
    note: `PARENT: ${parentName}${rec.infantDob ? ` · NÉ(E) LE ${rec.infantDob}` : ""}`,
    listName: VF_LIST_LABELS.INFANT,
    cardKey: VF_LIST_CARD_KEYS.INFANT,
    source: "VF_PD4ML",
    ssr: [],
    pnr: "",
    etkt: "",
    documentNumber: "",
    parentName,
    infantName,
    infantDob: rec.infantDob,
  };
}

export function lot2VfExtractInfantItems(text) {
  const records = lot2VfScanInfantRecords(text);
  return records.map((rec, i) => lot2VfBuildInfantItem(rec, i + 1));
}

// Outbound/Inbound Passenger Details List : structure entièrement différente
// des autres listes VF (un passager par correspondance, pas une simple table
// nom/classe/siège). Chaque enregistrement est repérable par le marqueur
// répété "VF12/CDG-SAW=>" (le vol principal), immuable pour tout le document :
// on découpe le texte sur ce marqueur plutôt que de classer token par token.
// Vérifié contre le vrai PDF fourni : Nom/Prénom sont dans l'ordre PRÉNOM puis
// NOM (inversé par rapport aux autres listes VF), et les colonnes Genre/Classe
// cabine ne portent aucun texte extractible dans ce document — la classe
// cabine VF n'ayant qu'un seul niveau, elle est donc fixée à "Y".
export function lot2VfScanConnectionRecords(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const boundaryRe = /^VF\d{1,4}\/[A-Z]{3}-[A-Z]{3}=>$/;
  const pnrRe = /^[0-9][A-Z0-9]{5}$/;
  const flightRe = /^(VF\d{1,4})\/(\d{1,2}[A-Z]{3})\/([A-Z]{3})\/STD:(\d{2}:\d{2})/;
  const records = [];
  let i = 0;
  while (i < lines.length) {
    if (!boundaryRe.test(lines[i])) {
      i++;
      continue;
    }
    i++;
    if (i < lines.length && /^STA:/i.test(lines[i])) i++;
    const flightLine1 = lines[i] || "";
    i++;
    i++; // continuation "Time Diff : XhYm", toujours sur exactement 2 lignes au total
    const m = flightLine1.match(flightRe);
    const given = lines[i] || "";
    i++;
    const surnameParts = [];
    while (i < lines.length && !pnrRe.test(lines[i]) && !boundaryRe.test(lines[i])) {
      surnameParts.push(lines[i]);
      i++;
    }
    let pnr = "";
    if (i < lines.length && pnrRe.test(lines[i])) {
      pnr = lines[i].toUpperCase();
      i++;
    }
    let weight = "";
    while (i < lines.length && /^\d{1,3}$/.test(lines[i])) {
      weight = lines[i];
      i++;
    }
    if (m && given && surnameParts.length) {
      records.push({
        flightNumber: m[1].toUpperCase(),
        destination: m[3].toUpperCase(),
        std: m[4],
        given: given.replace(/\s+/g, " ").trim(),
        surname: surnameParts.join(" ").replace(/\s+/g, " ").trim(),
        pnr,
        weight,
      });
    }
  }
  return records;
}

export function lot2VfBuildConnectionItem(rec, direction, seq) {
  return {
    id: `VF-${direction}-${seq}-${rec.surname}-${rec.given}`,
    seq,
    name: `${rec.surname}/${rec.given}`,
    title: "",
    gender: "",
    passengerType: "ADT",
    class: "Y",
    cabinClass: "Y",
    origin: "",
    destination: rec.destination,
    acceptance: "",
    seat: "",
    specific: "",
    note: "",
    listName: direction === "OUTBOUND" ? VF_LIST_LABELS.OUTBOUND_DETAILS : VF_LIST_LABELS.INBOUND_DETAILS,
    cardKey: direction,
    source: "VF_PD4ML",
    ssr: [],
    pnr: rec.pnr,
    etkt: "",
    documentNumber: "",
    connection: { flight: rec.flightNumber, airport: rec.destination, direction: direction.toLowerCase(), std: rec.std },
  };
}

export function lot2VfExtractConnectionItems(text, direction) {
  const records = lot2VfScanConnectionRecords(text);
  return records.map((rec, i) => lot2VfBuildConnectionItem(rec, direction, i + 1));
}

export function lot2VfExtractPassengerItems(text, kind) {
  if (kind === "OUTBOUND_SUMMARY") return [];
  if (kind === "INFANT") return lot2VfExtractInfantItems(text);
  if (kind === "OUTBOUND_DETAILS") return lot2VfExtractConnectionItems(text, "OUTBOUND");
  if (kind === "INBOUND_DETAILS") return lot2VfExtractConnectionItems(text, "INBOUND");
  const records = lot2VfScanRecords(text);
  return records.map((rec, i) => lot2VfBuildItem(rec, kind, i + 1));
}

export function lot2VfClassCounts(items) {
  // base.booked (widget "Booked / Classes") attend une classe cabine ("Y"/"C"/"F"),
  // pas le code tarifaire brut ("Y2","YL","YR"...) porté par chaque passager VF.
  // Sans ce regroupement, aucun code tarifaire n'égale jamais "Y" et le total
  // Booked reste à 0 malgré une injection réussie.
  const out = {};
  for (const p of items || []) {
    const c = lot2PassengerClassFromCode(p.class || p.cabinClass || "");
    if (!c) continue;
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}
