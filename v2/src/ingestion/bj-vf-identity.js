// Résolution d'identité de vol directement depuis l'en-tête d'un PDF BJ/VF
// ("03/Sep/2026 BJ511 CDG - TUN" / "03/Sep/2026 VF12 CDG - SAW"), utilisée
// AVANT le stockage du document pour que les chemins R2/D1 soient canoniques
// dès la première écriture. Porté verbatim depuis src/index.js v1 (R22.3).
//
// Fonctions indépendantes par compagnie : une évolution du format BJ ne
// touche jamais le détecteur VF, et inversement.

export const R223_MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function r223IsoDate(day, mon, year) {
  const mm = R223_MONTHS[String(mon || "").toUpperCase()];
  const dd = String(Number(day || 0)).padStart(2, "0");
  const yyyy = String(year || "");
  if (!mm || !/^20\d{2}$/.test(yyyy) || !/^\d{2}$/.test(dd)) return "";
  return `${yyyy}-${mm}-${dd}`;
}

export function r223DetectBjIdentityFromPdfText(text) {
  // On n'utilise volontairement jamais l'horodatage du nom de fichier pdf_* :
  // la date du vol vient uniquement de l'en-tête du document.
  const raw = String(text || "").replace(/ /g, " ").replace(/\r/g, "\n");

  const m = raw.match(
    /\b(\d{1,2})\/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(20\d{2})\s+(BJ)\s*(\d{1,4})\s+([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/i
  );
  if (!m) return null;

  const airline = String(m[4] || "").toUpperCase();
  const flightNumber = `${airline}${String(m[5] || "").replace(/\D/g, "")}`;
  const flightDate = r223IsoDate(m[1], m[2], m[3]);
  const origin = String(m[6] || "").toUpperCase();
  const destination = String(m[7] || "").toUpperCase();

  if (!/^BJ\d{1,4}$/.test(flightNumber)) return null;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(flightDate)) return null;

  return { airline, flightNumber, flightDate, origin, destination, source: "PDF_HEADER" };
}

export function r223DetectVfIdentityFromPdfText(text) {
  const raw = String(text || "").replace(/ /g, " ").replace(/\r/g, "\n");

  const m = raw.match(
    /\b(\d{1,2})\/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(20\d{2})\s+(VF)\s*(\d{1,4})\s+([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/i
  );
  if (!m) return null;

  const airline = String(m[4] || "").toUpperCase();
  const flightNumber = `${airline}${String(m[5] || "").replace(/\D/g, "")}`;
  const flightDate = r223IsoDate(m[1], m[2], m[3]);
  const origin = String(m[6] || "").toUpperCase();
  const destination = String(m[7] || "").toUpperCase();

  if (!/^VF\d{1,4}$/.test(flightNumber)) return null;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(flightDate)) return null;

  return { airline, flightNumber, flightDate, origin, destination, source: "PDF_HEADER" };
}

export function r223DetectBjVfIdentityFromPdfText(text) {
  // Point d'entrée conservé pour les appelants qui ne savent pas encore, à ce
  // stade, laquelle des deux compagnies ils lisent (le préfixe "pdf_" est
  // commun aux deux). La détection elle-même reste individuelle par
  // compagnie.
  return r223DetectBjIdentityFromPdfText(text) || r223DetectVfIdentityFromPdfText(text);
}
