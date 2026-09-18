// Vérification documentaire V50.32 : les résidus numériques et les chaînes
// déjà rendues doivent être ramenés à une durée HH:MM propre.
const roundMinutes = value => {
  if (value === '' || value === null || value === undefined) return value;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : value;
};

const normalizeDurationText = value => String(value || '').replace(
  /(^|[^0-9])(\d{1,3}):([0-5]\d)\.\d+(?=$|[^0-9])/g,
  '$1$2:$3'
);

console.assert(roundMinutes(730.00013333) === 730);
console.assert(roundMinutes('730') === 730);
console.assert(roundMinutes('') === '');
console.assert(roundMinutes(null) === null);
console.assert(normalizeDurationText('12:10.00013333') === '12:10');
console.assert(normalizeDurationText('Durée 12:10.00013333') === 'Durée 12:10');
console.assert(normalizeDurationText('12:10') === '12:10');
