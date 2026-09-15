// Moteur de classification des listes Altea génériques ("LIST OF: XXXX").
// Porté verbatim depuis src/index.js v1 — c'est le cœur validé cette
// session : classification basée sur le CONTENU du document plutôt que sur
// le nom de liste (qui varie librement d'une compagnie à l'autre, parfois
// même d'un vol à l'autre pour la même compagnie).
//
// Ordre de résolution (voir lot2LookupListMapping) :
//   1) table exacte par compagnie (LOT2_GENERIC_AIRLINE_LIST_MAPPINGS)
//   2) table exacte globale (LOT2_GENERIC_DEFAULT_LIST_MAPPINGS)
//   3) regex code repas ([A-Z]{2}ML)
//   4) repli sur le suffixe après une virgule ("<préfixe>, <suffixe>"),
//      jamais promu MASTER par comptage (allowMasterByCount=false)
//   5) signatures de contenu universelles (WCH/STAFF/MEAL)
//   6) heuristique par nombre de passagers (jamais sur un nom à virgule)
//   7) OTHER / NO_LIST

import { lot2Upper, lot2CleanText } from "../parsing/document-text.js";

export function lot2DetectListName(text, filename) {
  // V50.9 — STRICT EXPLICIT PDF LIST NAME
  // On ne déduit jamais le nom de liste depuis des mots passagers.
  //
  // Sources autorisées :
  //   1) une ligne explicite "LIST OF: XXXXX"
  //   2) un titre explicite de rapport résumé Altea :
  //      "INBOUND CUSTOMER SUMMARY" ou "ONCARRIAGE CUSTOMER SUMMARY"
  //
  // Si aucune source explicite n'est trouvée, on retourne "".
  const raw = lot2CleanText(String(text || "")).replace(/\r/g, "\n");
  const lines = raw.split(/\n+/).map((x) => String(x || "").trim()).filter(Boolean);

  function cleanListName(v) {
    return String(v || "")
      .replace(/\b(?:TOTAL|TTL)\b.*$/i, "")
      // Retirer seulement les compteurs de classe autonomes. Ne pas tronquer
      // les codes de rapports comme PDF-S1 / PDF-M2 / PDF-Z8.
      .replace(/(^|\s)[FJCWSYM]\s*\d+(?=\s|$)/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  for (const line of lines.slice(0, 160)) {
    const m = line.match(/\bLIST\s+OF\s*:\s*(.{2,140})$/i);
    if (!m) continue;
    const cleaned = cleanListName(m[1]);
    if (cleaned) return cleaned;
  }

  // OCR/text extraction peut parfois coller "LIST OF:" au milieu d'une ligne.
  const compact = raw.slice(0, 12000);
  const m = compact.match(/\bLIST\s+OF\s*:\s*([^\n\r]{2,140})/i);
  if (m) {
    const cleaned = cleanListName(m[1]);
    if (cleaned) return cleaned;
  }

  // Titres explicites de rapports sommaires, sans inventer de liste.
  for (const line of lines.slice(0, 80)) {
    if (/^INBOUND\s+CUSTOMER\s+SUMMARY\b/i.test(line)) return "INBOUND CUSTOMER SUMMARY";
    if (/^ONCARRIAGE\s+CUSTOMER\s+SUMMARY\b/i.test(line)) return "ONCARRIAGE CUSTOMER SUMMARY";
  }

  return "";
}

export const LOT2_GENERIC_DEFAULT_LIST_MAPPINGS = [
  ["ALL CUSTOMERS", "MASTER"],
  ["ALL PAX", "MASTER"],
  ["ALL RESERVATION", "MASTER"],
  // "PDF-ACC" (sans suffixe) est un sous-ensemble "accepté" des mêmes
  // passagers que ALL CUSTOMERS, même structure — vu identique chez LO et S4.
  ["PDF-ACC", "MASTER"],
  ["FQTV", "FQTV"],
  // "FQA" est le nom de liste réel envoyé par la plupart des compagnies
  // génériques (A9, AI, AT, EI, FB, LO, MS, RJ, S4, SB, SK, DE...), pas
  // seulement J2/AH où il était mappé jusqu'ici en dur par compagnie.
  ["FQA", "FQTV"],
  ["WCH", "WCH"],
  ["WCHR", "WCH"],
  ["WCHS", "WCH"],
  ["WCHC", "WCH"],
  ["WCMP", "WCH"],
  ["WCBD", "WCH"],
  ["WCLB", "WCH"],
  ["INF", "INF"],
  ["INFANT", "INF"],
  ["CHLD", "CHLD"],
  ["CHILD", "CHLD"],
  ["KID", "CHLD"],
  // Enfants + bébés combinés dans un seul document — vu identique chez RJ et
  // S4. Chacun garde sa propre carte (INF/CHLD), voir lot3MergeFlightData.
  ["PDF-INFKID", "INFKID"],
  ["ETKT", "ETKT"],
  ["TICKET", "ETKT"],
  // "PDF-ACCWEB" (enregistrement web) vu identique chez 3O/AH/EI/RJ/SB —
  // contenu vérifié sur 3O (44 passagers, "CHL-WEB", sièges attribués).
  ["PDF-ACCWEB", "WEB"],
  // "CHL-WEB" est aussi utilisée directement comme LIST OF chez SK/MS/FB/AI
  // (pas seulement comme SSR à l'intérieur de PDF-ACCWEB) — contenu vérifié
  // sur un vrai relevé SK réel (39/45 passagers, une ligne "CHL-WEB" par
  // passager, aucun autre code).
  ["CHL-WEB", "WEB"],
  ["EMD", "EMD"],
  ["MEAL", "MEAL"],
  ["SPML", "MEAL"],
  ["VGML", "MEAL"],
  ["AVML", "MEAL"],
  ["BBML", "MEAL"],
  ["CHML", "MEAL"],
  ["HNML", "MEAL"],
  ["KSML", "MEAL"],
  ["MOML", "MEAL"],
  // "LGML-GU" (low gluten) — contenu vérifié sur un vrai relevé SK réel.
  ["LGML", "MEAL"],
  ["INAD", "INAD"],
  ["DEPA", "DEPA"],
  ["DEPU", "DEPU"],
  // "SR-" (Special Request) est un préfixe Amadeus partagé, observé
  // identique chez A9, AT et SK.
  ["SR-DEPA", "DEPA"],
  ["SR-DEPU", "DEPU"],
  ["SR-PETC", "PETC"],
  ["SR-AVIH", "AVIH"],
  ["UMNR", "UMNR"],
  ["UM", "UMNR"],
  ["MAAS", "MAAS"],
  // Personnel compagnie (standby/bookable) — vu identique chez EI, LO, RJ.
  ["STF", "STAFF"],
  // "BS-SA" vu identique chez AH (déjà en dur) ET MS (contenu vérifié : 4
  // passagers, chacun avec le code "BS-SA" sur sa ligne) — généralisé ici.
  ["BS-SA", "STAFF"],
  // "PDF-FQTV" vu identique chez AI (contenu vérifié : 16 passagers avec
  // numéros de fidélité et mentions ACCRUAL/REDEMPTION).
  ["PDF-FQTV", "FQTV"],
  ["INC", "INBOUND"],
  ["INCARRIAGE", "INBOUND"],
  ["ONC", "OUTBOUND"],
  ["ONCARRIAGE", "OUTBOUND"],
  ["INBOUND CUSTOMER SUMMARY", "INBOUND_SUMMARY"],
  ["ONCARRIAGE CUSTOMER SUMMARY", "OUTBOUND_SUMMARY"],
  // Liste combinée INC+ONC dans un seul document — vue identique chez
  // OZ, DE, AI et SK. Contenu vérifié sur OZ.
  ["ONC* INC", "CONNECTIONS"],
];

export const LOT2_GENERIC_AIRLINE_LIST_MAPPINGS = {
  A9: [
    // Préfixe "PDF-" observé uniquement sur INAD pour cette compagnie.
    ["PDF-INAD", "INAD"],
  ],
  MS: [
    // "CAS-SB" (Casual Standby) : équivalent MS de STF-SB, sans code
    // distinctif propre dans la liste elle-même.
    ["CAS-SB", "STAFF"],
  ],
  TS: [
    // Même structure que PDF-ACC (liste passagers "accepted"), mais
    // avec le préfixe numéroté propre à TS.
    ["PDF-02ACC", "MASTER"],
  ],
  "3O": [
    // Certains rapports préfixent les listes standards par "PDF-ACC, " (le
    // contenu reste identique à la liste ETKT/KID nue observée par ailleurs).
    ["PDF-ACC, ETKT", "ETKT"],
    ["PDF-ACC, KID", "CHLD"],
  ],
  OZ: [
    // Libellés techniques observés dans les rapports Altea Asiana.
    ["PDF-M2", "MEAL"],
    ["PDF-S1", "STAFF"],
    ["PDF-Z8", "WEB"],
    ["PDF-Z93", "EMD"],
  ],
  DE: [
    // Condor utilise des numéros de listes à la place des noms fonctionnels.
    ["PDF-02", "WEB"],
    ["PDF-10", "WCH"],
  ],
  WB: [
    // RwandAir préfixe systématiquement ses listes par "X-TRT". X-TRT seule
    // est un export complet des passagers (comme ALL CUSTOMERS/MASTER).
    ["X-TRT", "MASTER"],
    ["X-TRT, ETKT", "ETKT"],
    ["X-TRT, ONC", "OUTBOUND"],
    ["X-TRT, INC", "INBOUND"],
    ["X-TRT, KID", "CHLD"],
    ["X-TRT, INF", "INF"],
    ["X-TRT, WCH", "WCH"],
    ["X-TRT, FQA", "FQTV"],
    ["X-TRT, EMD", "EMD"],
  ],
  J2: [
    ["FQA", "FQTV"],
    ["ONC", "OUTBOUND"],
    ["INC", "INBOUND"],
    ["WCH", "WCH"],
    ["INBOUND CUSTOMER SUMMARY", "INBOUND_SUMMARY"],
    ["ONCARRIAGE CUSTOMER SUMMARY", "OUTBOUND_SUMMARY"],
  ],
  AH: [
    ["FQA", "FQTV"],
    ["INC", "INBOUND"],
    ["WCH", "WCH"],
    ["BS-SA", "STAFF"],
    ["INBOUND CUSTOMER SUMMARY", "INBOUND_SUMMARY"],
    ["ONCARRIAGE CUSTOMER SUMMARY", "OUTBOUND_SUMMARY"],
  ],
  // SQ : construit à partir d'un vrai relevé (specific-list-survey) sur 30
  // mails réels avant toute sortie de l'ancien groupe verrouillé. "PDF-
  // VBCPLIST" seule (sans suffixe classe) est le manifeste complet du vol
  // (ex. observé : 211 pax F1/C40/S22/Y148). Les variantes "PDF-VBCPLIST,
  // CC-x" et "CC-x" seules sont des sous-ensembles déjà couverts par ce
  // manifeste : laissées en OTHER, elles se rattachent sans dégât aux
  // passagers déjà posés par MASTER (correspondance par nom/ETKT, jamais de
  // doublon).
  SQ: [
    ["PDF-VBCPLIST", "MASTER"],
    ["PDF-STFFIRM", "STAFF"],
    ["PDF-OSPLMAAS", "MAAS"],
    ["PDF-PSPLWCHR", "WCH"],
    ["PDF-DINLIST", "MEAL"],
    ["PDF-CINFT", "INF"],
    ["FQT-KFES", "FQTV"],
    ["FQT-KFEG", "FQTV"],
    ["PDF-IPPS, FQT-QPPS", "FQTV"],
    ["PDF-IPPS, FQT-TPPS", "FQTV"],
    ["PDF-AFQTA, FQT-KFEG", "FQTV"],
    ["PDF-AFQTA, FQT-KFES", "FQTV"],
  ],
};

export function lot2NormalizeListKey(v) {
  return lot2Upper(v)
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "MEAL" lui-même est exclu : mot anglais courant, recherché comme sous-chaîne
// dans tout le corps du document (voir plus bas), il donnerait de faux positifs.
export const LOT2_KNOWN_MEAL_CODES = LOT2_GENERIC_DEFAULT_LIST_MAPPINGS.filter(
  ([, cardKey]) => cardKey === "MEAL"
)
  .map(([name]) => lot2NormalizeListKey(name))
  .filter((name) => /^[A-Z]{2}ML$/.test(name));

export function lot2LookupListMapping(airline, listName, text, allowMasterByCount = true) {
  const raw = lot2NormalizeListKey(listName);
  if (!raw) return { cardKey: "NO_LIST", mappingScope: "NONE", matchedListName: "" };

  const airlineKey = lot2Upper(airline);
  const airlineRows = LOT2_GENERIC_AIRLINE_LIST_MAPPINGS[airlineKey] || [];

  for (const [name, cardKey] of airlineRows) {
    if (raw === lot2NormalizeListKey(name)) {
      return { cardKey, mappingScope: airlineKey, matchedListName: name };
    }
  }

  for (const [name, cardKey] of LOT2_GENERIC_DEFAULT_LIST_MAPPINGS) {
    if (raw === lot2NormalizeListKey(name)) {
      return { cardKey, mappingScope: "DEFAULT", matchedListName: name };
    }
  }

  // Groupes de codes repas : si le nom explicite LIST OF est un code meal connu.
  if (/^[A-Z]{2}ML$/.test(raw)) {
    return { cardKey: "MEAL", mappingScope: "DEFAULT_PATTERN", matchedListName: "MEAL_CODE" };
  }

  // Noms composés "<préfixe>, <suffixe>" (ex. "PDF-06, WCH" chez SK,
  // "X-TRT, MEAL" chez WB) : le préfixe varie d'une compagnie à l'autre (ou
  // d'un vol à l'autre, quand c'est un simple numéro de séquence sans
  // signification), mais le suffixe s'auto-désigne déjà avec un code connu —
  // même principe que "PDF-ACC, ETKT" déjà mappé en dur pour 3O, généralisé
  // ici pour ne pas avoir à lister chaque combinaison rencontrée au fur et à
  // mesure. Le préfixe lui-même n'est jamais interprété.
  const suffixM = String(listName || "").match(/^(.+?),\s*(.+)$/);
  if (suffixM) {
    // allowMasterByCount=false : un suffixe résolu isolément ("CC-Y" seul,
    // extrait de "PDF-VBCPLIST, CC-Y") ne doit jamais hériter du repli
    // "beaucoup de passagers ⇒ MASTER" plus bas — sinon le garde-fou contre
    // les sous-listes qualifiées par une virgule (voir plus bas) ne sert à
    // rien, car ce nom-ci ("CC-Y") ne contient lui-même pas de virgule.
    const suffixMapping = lot2LookupListMapping(airline, suffixM[2], text, false);
    if (suffixMapping.cardKey && suffixMapping.cardKey !== "OTHER" && suffixMapping.cardKey !== "NO_LIST") {
      return { cardKey: suffixMapping.cardKey, mappingScope: "SUFFIX_PATTERN", matchedListName: listName };
    }
  }

  // Dernier recours, universel : reconnaissance par CONTENU réel plutôt que
  // par nom de liste. Nécessaire car chaque compagnie sur "Generic Report"/
  // "altea_report.pdf" nomme ses listes différemment ("PDF-<n>" chez SK,
  // "CAS-AC" chez AH...), parfois avec un simple numéro de séquence qui ne
  // veut rien dire et change de sens d'un vol à l'autre (vérifié sur SK : le
  // même "PDF-06" désigne tantôt un manifeste, tantôt une sous-liste fauteuil
  // roulant) — aucune table de correspondance par nom ne peut suivre ça à
  // l'échelle de toutes les compagnies. On regarde donc d'abord les codes SSR
  // caractéristiques (universels, indépendants du nom de liste et de la
  // compagnie), puis, en dernier recours seulement, le nombre de passagers.
  if (text) {
    const body = lot2Upper(text);
    if (/\bWCH[RSC]\b|\bWCMP\b|\bWCBD\b|\bWCLB\b/.test(body)) {
      return { cardKey: "WCH", mappingScope: "CONTENT_PATTERN", matchedListName: listName };
    }
    if (/\bSTF-/.test(body)) {
      return { cardKey: "STAFF", mappingScope: "CONTENT_PATTERN", matchedListName: listName };
    }
    if (LOT2_KNOWN_MEAL_CODES.some((code) => body.includes(code))) {
      return { cardKey: "MEAL", mappingScope: "CONTENT_PATTERN", matchedListName: listName };
    }
    // Un nom qualifié par une virgule ("X, Y") désigne presque toujours un
    // SOUS-ENSEMBLE d'une liste de base déjà couverte ailleurs (ex. SQ
    // "PDF-VBCPLIST, CC-x" = filtre par classe cabine du même manifeste déjà
    // posé par "PDF-VBCPLIST" seul — volontairement laissé en OTHER). Jamais
    // promu MASTER par le seul comptage dans ce cas, même avec beaucoup de
    // passagers, pour ne jamais écraser le vrai manifeste complet par un
    // sous-total. Seuil (>=15) choisi avec une marge large des deux côtés :
    // les manifestes complets réellement observés font 24 à 59 passagers,
    // contre 1 à 14 pour toutes les sous-listes réelles rencontrées.
    if (!suffixM && allowMasterByCount) {
      const paxLines = (body.match(/^\s*\d{1,3}\.[A-Z]/gm) || []).length;
      if (paxLines >= 15) {
        return { cardKey: "MASTER", mappingScope: "CONTENT_PATTERN", matchedListName: listName };
      }
    }
  }

  return { cardKey: "OTHER", mappingScope: "UNMAPPED", matchedListName: "" };
}

export function lot2GenericCardFromListName(listName, airline) {
  return lot2LookupListMapping(airline, listName).cardKey;
}
