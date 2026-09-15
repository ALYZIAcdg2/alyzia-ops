const MONTHS = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
const FLIGHT = /\b([A-Z0-9]{2})\s?([0-9]{1,4}[A-Z]?)\b/g;
const ROUTE = /\b([A-Z]{3})\s*(?:-|–|→|\/|\bTO\b)\s*([A-Z]{3})\b/g;
const DATE = /\b(20\d{2}-\d{2}-\d{2}|20\d{6}|\d{1,2}[ /-]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ /-]?(?:20\d{2}|\d{2})?)\b/gi;
const NO_FLIGHT = new Set(['OF','IN','TO','ET','AT','NO','ON','BY','ID','FI','J0','Y0']);

export function canonicalDate(raw, contextDate = '') {
  const token = String(raw || '').toUpperCase().trim();
  let iso = token.match(/^20\d{2}-\d{2}-\d{2}$/) ? token : '';
  if (!iso && /^20\d{6}$/.test(token)) iso = `${token.slice(0,4)}-${token.slice(4,6)}-${token.slice(6)}`;
  if (!iso) {
    const m = token.replace(/[ /-]/g, '').match(/^(\d{1,2})([A-Z]{3})(20\d{2}|\d{2})?$/);
    if (!m || !MONTHS[m[2]]) return '';
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : 0;
    if (!year && /^20\d{2}-\d{2}-\d{2}$/.test(contextDate)) {
      year = Number(contextDate.slice(0,4));
      const diff = MONTHS[m[2]] - Number(contextDate.slice(5,7));
      if (diff > 6) year--; else if (diff < -6) year++;
    }
    if (!year) return '';
    iso = `${year}-${String(MONTHS[m[2]]).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
  }
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === iso ? iso : '';
}

export function resolveIdentity(document, hints = {}) {
  const text = String(document.text || '').toUpperCase();
  const header = text.slice(0,12000);
  const hintedAirline=String(hints.flight||'').toUpperCase().slice(0,2);
  const airlines=new Set(['TK','SQ','TW','BJ','VF','3O','WB','OZ','EI','LO','MS','RJ','SK','AT','AI','AH','IZ','TB','FB','S4','A9','DE','J2',hintedAirline]);
  const mentions = [...header.matchAll(FLIGHT)].filter(m => airlines.has(m[1]) &&
    /^[0-9]/.test(m[2])).map(m => ({flight:`${m[1]}${m[2]}`,index:m.index}));
  const flights = mentions.map(m=>m.flight);
  const routes = [...header.matchAll(ROUTE)].map(m => `${m[1]}-${m[2]}`);
  const dates = [...header.matchAll(DATE)].map(m => ({raw:m[1],index:m.index,
    iso:canonicalDate(m[1],hints.receivedAt?.slice(0,10))})).filter(d => d.iso);
  const flight = [...new Set(flights)];
  const route = [...new Set(routes)];
  const day = [...new Set(dates.map(d => d.iso))];
  const issues = [];
  const hintedFlight = String(hints.flight || '').toUpperCase().replace(/\s/g,'');
  const primary = mentions[0]?.flight || hintedFlight;
  if (flight.length > 1 && (!hintedFlight || primary!==hintedFlight)) issues.push('MULTIPLE_FLIGHTS');
  if (route.length > 1 && (!hints.route || route[0]!==String(hints.route).toUpperCase()))
    issues.push('MULTIPLE_ROUTES');
  const nearestDate=dates.filter(d=>mentions[0] && d.index>=mentions[0].index &&
    d.index-mentions[0].index<100)[0];
  if (day.length > 1 && !nearestDate) issues.push('MULTIPLE_DATES');
  // Metadata is a hint only: a contradictory document is never silently reassigned.
  const hintedDate = canonicalDate(hints.date, hints.receivedAt?.slice(0,10));
  const hintedRoute = String(hints.route || '').toUpperCase();
  if (primary && hintedFlight && primary !== hintedFlight) issues.push('FLIGHT_CONFLICT');
  if (nearestDate?.iso && hintedDate && nearestDate.iso !== hintedDate) issues.push('DATE_CONFLICT');
  if (!nearestDate && day.length === 1 && hintedDate && day[0] !== hintedDate) issues.push('DATE_CONFLICT');
  if (route.length === 1 && hintedRoute && route[0] !== hintedRoute) issues.push('ROUTE_CONFLICT');
  const resolvedFlight = primary;
  const resolvedDate = nearestDate?.iso || day[0] || hintedDate;
  const resolvedRoute = route[0] || hintedRoute;
  if (!resolvedFlight || !resolvedDate || !resolvedRoute) issues.push('IDENTITY_INCOMPLETE');
  return {airline:resolvedFlight.slice(0,2),flightNumber:resolvedFlight,
    serviceDateRaw:nearestDate?.raw || dates[0]?.raw || String(hints.date || ''),serviceDateInternal:resolvedDate,
    route:resolvedRoute,origin:resolvedRoute.slice(0,3),destination:resolvedRoute.slice(-3),
    key:`${resolvedDate}|${resolvedFlight.slice(0,2)}|${resolvedFlight}`,
    evidence:{flights:flight,routes:route,dates},issues};
}
