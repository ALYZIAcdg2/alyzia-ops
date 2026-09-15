// Libellés humains pour les catégories opérationnelles (base.common) — les
// clés techniques viennent de la fusion LOT3 (v2/src/injection/merge-flight-data.js).
export const COMMON_LABELS = {
  WCH: "PMR (fauteuil roulant)",
  CHLD: "Enfants",
  INF: "Bébés",
  UMNR: "Mineurs non accompagnés",
  MAAS: "Assistance médicale",
  FQTV: "Fidélité",
  STAFF: "Personnel",
  MEAL: "Repas spéciaux",
  EMD: "EMD",
  ETK: "Billets électroniques",
  INAD: "Inadmissibles",
  DEPA: "Déportés accompagnés",
  DEPU: "Déportés non accompagnés",
  CBAG: "Bagage cabine",
};

// Ordre d'affichage : d'abord les catégories opérationnelles sensibles
// (PMR/enfants/bébés/mineurs/assistance — la préoccupation "UM/PMR" citée
// par l'utilisateur), puis le reste.
export const COMMON_ORDER = ["WCH", "UMNR", "CHLD", "INF", "MAAS", "STAFF", "FQTV", "MEAL", "EMD", "ETK", "CBAG", "INAD", "DEPA", "DEPU"];

export function classLabel(code) {
  // Chaque compagnie garde sa propre lettre de classe — jamais convertie.
  return String(code || "").toUpperCase();
}

const CLASS_RANK = { F: 0, A: 0, J: 1, C: 1, D: 1, I: 1, Z: 1, W: 2, S: 2, P: 2, O: 2 };

function rankClass(code) {
  return CLASS_RANK[String(code || "").toUpperCase()] ?? 3;
}

// Ordre d'affichage cabine → économie (F/J/C d'abord, Y/M et le reste en
// dernier), sans jamais renommer la lettre elle-même.
export function orderedClassCodes(classCounts) {
  return Object.keys(classCounts || {}).sort((a, b) => rankClass(a) - rankClass(b) || a.localeCompare(b));
}
