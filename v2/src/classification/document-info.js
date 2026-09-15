// Extraction d'informations complémentaires sur un document déjà classifié
// (comptage passagers/classe, date réelle du vol depuis la ligne rapport,
// lignes de correspondance, informations opérationnelles STD/STA/config
// avion). Porté verbatim depuis src/index.js v1.

import { lot2Upper, lot2CleanText } from "../parsing/document-text.js";
import { lot2ExtractClassCounts } from "./class-counts.js";
import { guessDocumentType } from "../ingestion/flight-identity.js";

export function lot2IsConnectionSummaryList(listName, cardKey) {
  const l = lot2Upper(listName);
  const c = lot2Upper(cardKey);
  return (
    /(?:INBOUND|ONCARRIAGE)\s+CUSTOMER\s+SUMMARY/.test(l) ||
    /^(?:INBOUND|OUTBOUND)_SUMMARY$/.test(c) ||
    (/(?:INBOUND|OUTBOUND)/.test(c) && /CUSTOMER\s+SUMMARY/.test(l))
  );
}

export function lot2ExtractConnectionSummaryCounts(text) {
  // Les rapports "INBOUND CUSTOMER SUMMARY" et "ONCARRIAGE CUSTOMER SUMMARY"
  // ne sont pas des listes nominatives. Il ne faut jamais compter J274/J2809
  // comme passagers. Format Altea observé :
  //   FLTNR STA/STD DEP/ARR DEST CONX C Y C Y TTL
  //   AV54 0655 BOG GYD 05H00 0 1 0 0 0
  //   J2645 2015 SVX 01H10 2 6 2 1 0
  // On additionne uniquement les deux premiers chiffres C/Y après CONX.
  const up = lot2Upper(text);
  const out = { C: 0, Y: 0 };
  let rows = 0;

  for (const line of up.split(/\n+/)) {
    const r = line.trim().replace(/\s+/g, " ");
    if (!r) continue;
    if (/^(FLTNR|BOOKED|TER:|GATE:|CDG-|INBOUND CONNECTION|OUTBOUND CONNECTION)/.test(r)) continue;

    // On ne lit jamais les chiffres du numéro de vol. On cherche le bloc
    // CONX HHHMM puis les colonnes C/Y qui suivent.
    const m = r.match(/^([A-Z0-9]{2,4}\d{1,4})\s+\d{3,4}\s+(?:(?:[A-Z]{3})\s+){1,2}\d{2}H\d{2}\s+(\d{1,4})\s+(\d{1,4})(?:\s+\d{1,4}){0,3}\b/);
    if (!m) continue;

    out.C += Number(m[2] || 0);
    out.Y += Number(m[3] || 0);
    rows++;
  }

  return { classCounts: out, total: out.C + out.Y, rows };
}

export function lot2ExtractClassCountsForDocument(text, listName, cardKey) {
  if (lot2IsConnectionSummaryList(listName, cardKey)) {
    return lot2ExtractConnectionSummaryCounts(text).classCounts;
  }
  return lot2ExtractClassCounts(text);
}

export function lot2ExtractPassengerCount(text, listName, cardKey) {
  if (lot2IsConnectionSummaryList(listName, cardKey)) {
    return lot2ExtractConnectionSummaryCounts(text).total;
  }

  const up = lot2Upper(text);
  const header = up.match(/\bLIST\s+OF\s*:\s*[^\n\r]{0,200}/);
  const h = header ? header[0] : up.slice(0, 2000);
  let m = h.match(/\bTOTAL\s*(\d{1,5})\b/);
  if (m) return Number(m[1]);
  m = h.match(/\bTTL\s*(\d{1,5})\b/);
  if (m) return Number(m[1]);
  const classCounts = lot2ExtractClassCounts(h);
  const sum = Object.values(classCounts).reduce((a, b) => a + Number(b || 0), 0);
  if (sum > 0) return sum;

  // Fallback nominatif Altea : lignes commençant par numéro + NOM/PRENOM.
  const names = new Set();
  for (const line of up.split(/\n+/)) {
    const r = line.trim();
    const nm = r.match(/^\s*\d{1,4}[.)]?\s*([A-Z][A-Z' .-]{1,60}\/[A-Z][A-Z' .-]{1,80})/);
    if (nm) names.add(nm[1].replace(/\s+/g, " "));
  }
  if (names.size) return names.size;
  return 0;
}

export function lot2Preview(text) {
  return lot2CleanText(text).slice(0, 2500);
}

export function lot2DocumentTypeFromCard(cardKey, filename, mime) {
  if (cardKey === "MASTER") return "ALL_CUSTOMERS";
  if (cardKey && cardKey !== "OTHER") return cardKey;
  return guessDocumentType(filename, mime, "");
}

const LOTX_MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function lot2DateRawToIso(dayMon, contextIso) {
  const m = String(dayMon || "").toUpperCase().match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/);
  if (!m) return "";
  const day = String(Number(m[1])).padStart(2, "0");
  const mon = LOTX_MONTHS[m[2]];
  let year = Number(String(contextIso || "").slice(0, 4)) || new Date().getUTCFullYear();

  // Gestion passage mois: rapport fin août, vol 01SEP => même année.
  // Rapport fin décembre, vol 01JAN => année +1.
  const ctxMon = Number(String(contextIso || "").slice(5, 7)) || 0;
  const targetMon = Number(mon);
  if (ctxMon === 12 && targetMon === 1) year += 1;
  if (ctxMon === 1 && targetMon === 12) year -= 1;

  return `${year}-${mon}-${day}`;
}

export function lot2DetectFlightDateFromReportLine(text, airline, flightNumber, currentIso) {
  // V50.17 — date réelle du vol générique. Ignore la date d'émission du
  // rapport en haut à droite (ex: 30AUG2026 07:46Z). Prend la date de la
  // ligne vol : "AH1003  01SEP  CDG STD1215"
  const up = lot2Upper(text).replace(/\r/g, "\n");
  const a = String(airline || "").toUpperCase();
  const f = String(flightNumber || "").toUpperCase();
  const num = f.replace(a, "");
  const variants = [f, `${a}${num}`, `${a} ${num}`].filter(Boolean).map((v) => v.replace(/\s+/g, "\\s*"));
  for (const line of up.split(/\n+/).slice(0, 220)) {
    const l = line.trim().replace(/\s+/g, " ");
    if (!l) continue;
    if (!/STD\s*\d{3,4}/.test(l)) continue;
    if (!new RegExp(`\\b(?:${variants.join("|")})\\b`).test(l.replace(/\s+/g, ""))) {
      // fallback with spaces normalized
      if (!new RegExp(`\\b${a}\\s*${num}\\b`).test(l)) continue;
    }
    const dm = l.match(/\b(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/);
    if (dm) {
      const iso = lot2DateRawToIso(dm[1], currentIso);
      if (iso) return { iso, raw: dm[1], line: l };
    }
  }

  // Fallback plus permissif : AH1003 01SEP même si STD a sauté de l'extraction.
  const compact = up.slice(0, 12000).replace(/\s+/g, " ");
  const re = new RegExp(`\\b${a}\\s*${num}\\s+(\\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\\b`);
  const m = compact.match(re);
  if (m) {
    const iso = lot2DateRawToIso(m[1], currentIso);
    if (iso) return { iso, raw: m[1], line: m[0] };
  }

  return { iso: "", raw: "", line: "" };
}

function lot2CleanClock(v) {
  const s = String(v || "").trim();
  const m = s.match(/(\d{1,2})[:H.]?(\d{2})/);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

export function lot2ExtractConnectionRows(text, listName, cardKey) {
  const rawCard = String(cardKey || "").toUpperCase();
  const c = rawCard === "INBOUND_SUMMARY" ? "INBOUND" : rawCard === "OUTBOUND_SUMMARY" ? "OUTBOUND" : rawCard;
  if (c !== "INBOUND" && c !== "OUTBOUND") return [];
  const rows = [];
  const up = lot2Upper(text);
  for (const line of up.split(/\n+/)) {
    const r = line.trim().replace(/\s+/g, " ");
    if (!r || /^(FLTNR|BOOKED|TER:|GATE:|CDG-|INBOUND CONNECTION|OUTBOUND CONNECTION)/.test(r)) continue;
    const m = r.match(/\b([A-Z0-9]{2,5})\s+(\d{3,4})\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2}H[0-5]\d)\s+(\d{1,3})\s+(\d{1,3})\b/);
    if (m) {
      rows.push({
        flight: m[1],
        time: lot2CleanClock(m[2]),
        from: m[3],
        to: m[4],
        conx: m[5],
        classCounts: { C: Number(m[6]), Y: Number(m[7]) },
        direction: c,
      });
    }
  }
  return rows;
}

export function lot2ParseOperationalInfo(text, airline, flightNumber, currentIso) {
  // V50.20 — OPERATIONAL_INFO strict.
  // Injection autorisée UNIQUEMENT : STD, STA, DUREE (TOTAL ELAPSED TIME),
  // ROUTE dep/dest, TYPE A/C, CONFIGURATION/CAPACITY. Jamais : BOARDING,
  // GATE, ACCEPTANCE STATUS.
  const raw = String(text || "").replace(/\r/g, "\n");
  const up = lot2Upper(raw);
  const genericReport = /\bGENERIC\s+REPORT\b/.test(up);
  if (!/\bJFE\s+SCREEN\s+COPY\b/.test(up) && !/\bAIRCRAFT\b/.test(up) && !genericReport) return null;

  const info = {};
  const detectedDate = lot2DetectFlightDateFromReportLine(raw, airline, flightNumber, currentIso);
  if (detectedDate.iso) info.date = detectedDate.iso;

  // Rapports Altea génériques : identité et STD dans l'en-tête, route dans
  // les lignes passagers (ex. OZ502 06SEP CDG STD1910 / ... CDG ICN ...).
  if (genericReport) {
    const cleanFlight = String(flightNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const headerRe = new RegExp(`\\b${cleanFlight}\\s+\\d{1,2}[A-Z]{3}\\s+([A-Z]{3})\\s+STD\\s*([0-2]?\\d{3})\\b`);
    const hm = up.match(headerRe);
    if (hm) {
      info.dep = hm[1];
      info.std = lot2CleanClock(hm[2]);
    }
    const passengerRoute = up.match(/^\s*\d+\.[^\n]*?\s([A-Z]{3})\s+([A-Z]{3})\s+[A-Z][A-Z0-9]?\s/m);
    if (passengerRoute) {
      info.dep = info.dep || passengerRoute[1];
      if (passengerRoute[2] !== info.dep) info.dest = passengerRoute[2];
    }
  }

  // Route depuis bloc AIRPORT ou ligne CDG-ALG.
  const airportBlock = raw.match(/\bAIRPORT\s*:\s*([\s\S]{0,180}?)(?:\bELAPSED\s+TIME\b|\bSCHEDULED\b|\bTOTAL\s+ELAPSED\b)/i);
  if (airportBlock) {
    const codes = (airportBlock[1].match(/\b[A-Z]{3}\b/g) || []).filter((c) => !["STD", "STA"].includes(c));
    if (codes.length >= 2) {
      info.dep = codes[0];
      info.dest = codes[1];
    }
  }
  let m = up.match(/\b([A-Z]{3})-([A-Z]{3})\b/);
  if (m) {
    info.dep = info.dep || m[1];
    info.dest = info.dest || m[2];
  }

  // STD direct en haut.
  m = raw.match(/\bSTD\s*:\s*([0-2]?\d[:.]?\d{2})/i);
  if (m) info.std = lot2CleanClock(m[1]);

  // Bloc SCHEDULED : première heure = STD, deuxième heure = STA.
  const scheduledBlock = raw.match(/\bSCHEDULED\s*:\s*([\s\S]{0,180}?)(?:\bTOTAL\s+ELAPSED\s+TIME\b|\bCOMMENTS\b|\[|$)/i);
  if (scheduledBlock) {
    const times = [...scheduledBlock[1].matchAll(/\b([0-2]?\d[:.]?\d{2})\b/g)].map((x) => lot2CleanClock(x[1])).filter(Boolean);
    if (times[0]) info.std = info.std || times[0];
    if (times[1]) info.sta = times[1];
  }

  // Parfois le texte réécrit "STD 12:15 / STD 13:30".
  if (!info.sta) {
    const stdTimes = [...raw.matchAll(/\bSTD\s*[: ]\s*([0-2]?\d[:.]?\d{2})\b/gi)].map((x) => lot2CleanClock(x[1])).filter(Boolean);
    if (stdTimes[0]) info.std = info.std || stdTimes[0];
    if (stdTimes[1]) info.sta = stdTimes[1];
  }

  // Durée : source officielle = TOTAL ELAPSED TIME, pas différence simple STD/STA.
  m = raw.match(/\bTOTAL\s+ELAPSED\s+TIME\s*:\s*([\s\S]{0,80})/i);
  if (m) {
    const dm = m[1].match(/\b(\d{1,2})H\s*([0-5]\d)\b/i) || m[1].match(/\b(\d{1,2})[:.]([0-5]\d)\b/);
    if (dm) {
      const h = String(Number(dm[1])).padStart(2, "0");
      const mm = String(dm[2]).padStart(2, "0");
      info.duration = `${h}H${mm}`;
      info.durationMinutes = Number(dm[1]) * 60 + Number(dm[2]);
    }
  }

  // Ligne avion : CDG-ALG |738 | |14 |165 |14 |165 |10
  // REG peut être vide. On ne doit jamais prendre "14" comme immatriculation.
  for (const line of up.split(/\n+/)) {
    const l = line.trim();
    if (!/\b[A-Z]{3}-[A-Z]{3}\b/.test(l)) continue;
    const clean = l.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    const t = clean.split(" ");
    const routeIdx = t.findIndex((x) => /^[A-Z]{3}-[A-Z]{3}$/.test(x));
    if (routeIdx < 0 || !t[routeIdx + 1]) continue;

    const route = t[routeIdx].split("-");
    info.dep = info.dep || route[0];
    info.dest = info.dest || route[1];
    info.aircraft = t[routeIdx + 1]; // TYPE A/C

    let p = routeIdx + 2;
    if (t[p] && !/^\d+$/.test(t[p])) {
      // immat renseignée explicitement uniquement si alphanum non numérique.
      // Pour AH1003, REG vide => on ne touche pas immat.
      p++;
    }

    const nums = t.slice(p).filter((x) => /^\d+$/.test(x)).map(Number);
    if (nums.length >= 4) {
      info.config = { C: nums[0], Y: nums[1] };
      info.capacity = { C: nums[2], Y: nums[3] };
    }
    break;
  }

  const has = Object.keys(info).length > 0;
  return has ? info : null;
}
