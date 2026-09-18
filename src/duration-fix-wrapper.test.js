// Vérification documentaire V50.31 : le correctif doit ramener les résidus
// flottants à une minute entière sans transformer une valeur vide en zéro.
const roundMinutes = value => {
  if (value === '' || value === null || value === undefined) return value;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : value;
};

console.assert(roundMinutes(730.00013333) === 730);
console.assert(roundMinutes('730') === 730);
console.assert(roundMinutes('') === '');
console.assert(roundMinutes(null) === null);
