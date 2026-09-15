// Normalisation de dates au format Altea ("03SEP", "03SEP2026", "2026-09-03"...)
// vers ISO. Porté verbatim depuis src/index.js v1.

export const LOTX_MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function lot2DateRawToIso(dayMon, contextIso) {
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

export function lot5CanonicalFlightDate(value, contextIso = "") {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const compact = raw.replace(/[\s/_-]+/g, "");
  if (/^20\d{6}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const months = LOTX_MONTHS;
  const withYear = compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})$/);
  if (withYear) {
    const yy = String(withYear[3]);
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${months[withYear[2]]}-${String(Number(withYear[1])).padStart(2, "0")}`;
  }
  if (/^\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(compact)) {
    try {
      const iso = lot2DateRawToIso(compact, String(contextIso || "").slice(0, 10));
      if (iso) return iso;
    } catch (e) {}
    const m = compact.match(/^(\d{1,2})([A-Z]{3})$/);
    if (m) {
      const year = Number(String(contextIso || "").slice(0, 4)) || new Date().getUTCFullYear();
      return `${year}-${months[m[2]]}-${String(Number(m[1])).padStart(2, "0")}`;
    }
  }
  return raw;
}

export function mailRawDateToIso(raw, receivedAt) {
  raw = String(raw || "").toUpperCase().trim();
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const compact = raw.replace(/[\s\/_-]+/g, "");
  if (/^20\d{6}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const months = LOTX_MONTHS;
  const withYear = compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})$/);
  if (withYear) {
    const yy = String(withYear[3]);
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${months[withYear[2]]}-${String(Number(withYear[1])).padStart(2, "0")}`;
  }
  const m = compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/);
  if (!m) return raw;
  let y = new Date(receivedAt || Date.now()).getUTCFullYear();
  const ctxM = new Date(receivedAt || Date.now()).getUTCMonth() + 1;
  const targetM = Number(months[m[2]]);
  if (ctxM === 12 && targetM === 1) y += 1;
  if (ctxM === 1 && targetM === 12) y -= 1;
  return `${y}-${months[m[2]]}-${String(Number(m[1])).padStart(2, "0")}`;
}
