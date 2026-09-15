export function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function formatDateFr(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "—");
  const days = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
  const d = new Date(`${iso}T00:00:00Z`);
  const dayName = Number.isNaN(d.getTime()) ? "" : days[d.getUTCDay()];
  return `${dayName ? dayName + " " : ""}${m[3]}/${m[2]}/${m[1]}`;
}

export function formatTime(t) {
  const s = String(t || "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return s;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function sum(obj) {
  return Object.values(obj || {}).reduce((a, b) => a + Number(b || 0), 0);
}
