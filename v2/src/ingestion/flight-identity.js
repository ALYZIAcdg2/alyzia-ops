// Détection de l'identité de vol (compagnie/numéro/date) depuis un mail, et
// décision de savoir si un mail est "opérationnel" (à traiter) ou du bruit.
// Porté verbatim depuis src/index.js v1.

import { lot2Upper } from "../parsing/document-text.js";
import { lot2IsIportBodyV1 } from "../parsers/iport.js";

export function isValidAirlineCodeV53(code) {
  const c = String(code || "").toUpperCase().trim();
  return /^[A-Z0-9]{2}$/.test(c) && /[A-Z]/.test(c);
}

export function extractFlightTokenV53(text) {
  const src = String(text || "").toUpperCase();
  const re = /\b([A-Z0-9]{2})\s*[- ]?\s*(\d{1,4}[A-Z]?)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const airline = String(m[1] || "").toUpperCase();
    if (!isValidAirlineCodeV53(airline)) continue;
    let num = String(m[2] || "").toUpperCase();
    if (!/\d/.test(num)) continue;
    // Source iPort (IZ/TB) : le même vol peut être numéroté "742" ou "0742"
    // selon la liste ("All passengers" vs "PIL by SSR category"). Sans cette
    // normalisation, ces deux formats créent deux fiches vol distinctes pour
    // le même vol réel.
    if (/^(IZ|TB)$/.test(airline)) num = num.replace(/^0+(?=\d)/, "");
    return { airline, flightNumber: `${airline}${num}` };
  }
  return null;
}

export function extractFlightDateTokenV53(text) {
  const src = String(text || "").toUpperCase();
  // LOT 5.3.1 : les sujets historiques PREPASQ utilisent par ex.
  // SQ335/20260905/CDG 2026/09/02 14:49.
  // 20260905 = DATE DU VOL ; 2026/09/02 = horodatage du document/mail.
  // On prend donc d'abord la date compacte placée dans l'identité du vol.
  const d0 = src.match(/(?:^|\b[A-Z0-9]{2}\s*[- ]?\s*\d{1,4}[A-Z]?\s*[\/_-])((?:20)\d{2})(\d{2})(\d{2})(?=[\/_-]|\b)/);
  if (d0) return `${d0[1]}-${d0[2]}-${d0[3]}`;
  const dCompact = src.match(/\b((?:20)\d{2})(\d{2})(\d{2})\b/);
  if (dCompact) return `${dCompact[1]}-${dCompact[2]}-${dCompact[3]}`;
  const d1y = src.match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})\b/);
  if (d1y) {
    const yy = String(d1y[3]);
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    const months = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    return `${yyyy}-${months[d1y[2]]}-${String(Number(d1y[1])).padStart(2, "0")}`;
  }
  const d1 = src.match(/\b(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/);
  if (d1) return d1[1];
  const d2 = src.match(/\b(20\d{2}[-_/]\d{2}[-_/]\d{2})\b/);
  return d2 ? String(d2[1]).replace(/[\/_]/g, "-") : "";
}

export function detectMailFlight(subject, filename, body) {
  // V5.3 : l'identité du vol ne doit jamais être déduite d'abord d'un
  // horodatage de fichier. Priorité stricte : SUJET -> CORPS MAIL -> NOM DE FICHIER.
  const sources = [String(subject || ""), String(body || ""), String(filename || "")];
  const out = { airline: "", flightNumber: "", flightDate: "" };
  for (const src of sources) {
    const f = extractFlightTokenV53(src);
    if (f) {
      out.airline = f.airline;
      out.flightNumber = f.flightNumber;
      break;
    }
  }
  for (const src of sources) {
    const d = extractFlightDateTokenV53(src);
    if (d) {
      out.flightDate = d;
      break;
    }
  }
  return out;
}

export function isOperationalCandidateMailV53(subject, bodyText, parts, flightBase) {
  // PREPA Historique est une source opérationnelle normale de backfill :
  // aucune exclusion par expéditeur ; les mêmes règles d'identité et de
  // contenu s'appliquent.
  const subjectText = String(subject || "");
  const body = String(bodyText || "");
  const src = lot2Upper(`${subjectText}\n${body}`);
  const hasFlight = !!(flightBase?.airline && flightBase?.flightNumber && isValidAirlineCodeV53(flightBase.airline));
  if (!hasFlight) return false;
  if (/\bPREPA\b|\bCHECK\s+IN\s+INFORMATION\b|\bJFE\s+SCREEN\s+COPY\b|\bLIST\s+OF\s*:|\bALTEA\b|\bSSR\b|\bFQTV\b|\bETKT\b|\bOUTBOUND\b|\bINBOUND\b/.test(src)) return true;
  // Source iPort (res2.iport.servers@res2.eu) : corps mail texte sans pièce
  // jointe, format "LIST TOTAL:" propre à IZ/TB, jamais "LIST OF:". Sans ce
  // cas dédié, ces mails sont ignorés IGNORED_NON_OPERATIONAL et invisibles
  // côté fiche vol.
  if (/^(IZ|TB)$/.test(String(flightBase?.airline || "").toUpperCase()) && lot2IsIportBodyV1(body)) return true;
  return (parts || []).some((p) => {
    const f = String(p?.filename || "").toLowerCase();
    const mime = String(p?.mimeType || "").toLowerCase();
    return /(?:altea_report|^pdf_.*(?:list|summary)|\.(?:pdf|eml|txt))/.test(f) || /(?:application\/pdf|message\/rfc822|text\/plain)/.test(mime);
  });
}

export function guessDocumentType(filename, mime, textProbe) {
  const f = String(filename || "").toUpperCase();
  const p = String(textProbe || "").toUpperCase();
  if (/ALL\s+(CUSTOMERS|PAX)|LIST\s+OF\s*:\s*ALL\s+(CUSTOMERS|PAX)/.test(p)) return "ALL_CUSTOMERS";
  if (/FQTV/.test(p) || /FQTV/.test(f)) return "FQTV";
  if (/ETKT|TICKET/.test(p) || /ETKT|TICKET/.test(f)) return "ETKT";
  if (/\bEMD\b/.test(p) || /\bEMD\b/.test(f)) return "EMD";
  if (/WCHR|WCHS|WCHC|\bWCH\b/.test(p) || /WCHR|WCHS|WCHC|\bWCH\b/.test(f)) return "WCH";
  if (/INFANT|\bINF\b/.test(p) || /INFANT|\bINF\b/.test(f)) return "INF";
  if (/CHILD|CHLD|\bKID\b/.test(p) || /CHILD|CHLD|\bKID\b/.test(f)) return "CHLD";
  if (/MEAL|[A-Z]{2}ML/.test(p) || /MEAL|[A-Z]{2}ML/.test(f)) return "MEAL";
  if (/STAFF|REBATE|BOOKABLE|\bBS-SA\b/.test(p) || /STAFF|REBATE|BOOKABLE|\bBS-SA\b/.test(f)) return "STAFF";
  if (/INAD/.test(p) || /INAD/.test(f)) return "INAD";
  if (/DEPA/.test(p) || /DEPA/.test(f)) return "DEPA";
  if (/DEPU/.test(p) || /DEPU/.test(f)) return "DEPU";
  if (/UMNR|\bUM\b/.test(p) || /UMNR|\bUM\b/.test(f)) return "UMNR";
  if (/MAAS/.test(p) || /MAAS/.test(f)) return "MAAS";
  if (/INBOUND|CONNECTION FROM/.test(p) || /INBOUND/.test(f)) return "INBOUND";
  if (/OUTBOUND|ONCARRIAGE|CONNECTION TO/.test(p) || /OUTBOUND/.test(f)) return "OUTBOUND";
  if (/\.PDF$/i.test(filename)) return "PDF";
  if (/\.TXT$/i.test(filename)) return "TXT";
  if (/\.CSV$/i.test(filename)) return "CSV";
  if (/\.XLSX?$/i.test(filename)) return "EXCEL";
  if (/\.EML$/i.test(filename)) return "EML";
  if (/\.ZIP$/i.test(filename)) return "ZIP";
  return String(mime || "").split("/").pop()?.toUpperCase() || "OTHER";
}

export function normalizeFilename(v) {
  return (
    String(v || "file")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase() || "file"
  );
}

export function plainTextOperationalKindV53(subject, body, flightBase) {
  const src = lot2Upper(`${subject || ""}\n${body || ""}`);
  const tk = /\bTK\d{1,4}\b/.test(src) && /\bCHECK\s+IN\s+INFORMATION\b/.test(src);
  if (tk) return "TK_TEXT";
  const jfe = /\bJFE\s+SCREEN\s+COPY\b/.test(src);
  if (jfe) return "JFE_SCREEN_COPY";
  if (/^(IZ|TB)$/.test(String(flightBase?.airline || "").toUpperCase()) && lot2IsIportBodyV1(body)) return "IPORT_TEXT";
  // V3.5: TW et autres prépas texte reconnues par identité vol + marqueurs
  // opérationnels. On ne change aucun parser spécifique : on transforme
  // seulement le corps Gmail en vraie source importable.
  const hasFlight = /\b(?:[A-Z][A-Z0-9]|[0-9][A-Z0-9])\s?\d{2,4}\b/.test(src);
  const hasOps = /\b(?:PREPA|CHECK\s*IN|STD|ETD|ATD|BOARD(?:ING)?|CFG|CONFIG|PAX|SSR|LIST\s+OF|BOOKED|ACCEPTED|INBOUND|OUTBOUND|FQTV|ETKT|EMD)\b/.test(src);
  if (hasFlight && hasOps) return /\bTW\s?\d{2,4}\b/.test(src) ? "TW_TEXT" : "MAIL_BODY_TEXT";
  return "";
}

export function isPlainTextOperationalMail(subject, body, flightBase) {
  return !!plainTextOperationalKindV53(subject, body, flightBase);
}
