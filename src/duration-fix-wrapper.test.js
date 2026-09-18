const oldFormatter =
  "function durationText(m){const n=Number(m);return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";
const newFormatter =
  "function durationText(m){const n=Math.round(Number(m));return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";

const patchDurationFormatter = html => String(html || '').includes(oldFormatter)
  ? String(html || '').replaceAll(oldFormatter, newFormatter)
  : String(html || '');

const pad = n => Number(n) < 10 ? String(Number(n)) : String(Number(n));
const padMinute = n => String(Number(n)).padStart(2, '0');
const durationText = m => {
  const n = Math.round(Number(m));
  return Number.isFinite(n) && n > 0
    ? pad(Math.floor(n / 60)) + ':' + padMinute(n % 60)
    : '—';
};

console.assert(durationText(114.9891499999999) === '1:55');
console.assert(durationText(730.00013333) === '12:10');
console.assert(durationText(115) === '1:55');
console.assert(durationText(null) === '—');
console.assert(patchDurationFormatter(oldFormatter).includes('Math.round(Number(m))'));
