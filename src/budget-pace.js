// Étalement du budget d'appels dans la journée.
// Avant : chaque fournisseur dépensait son plafond journalier dès les premiers passages du cron (Skylink 40 appels épuisés à 08 h,
// FlightRadar 25 à 08 h 30, FR24 départs 16 à 03 h 30) et il ne restait plus rien l'après-midi, quand les ETD tombent.
// Règle : à l'heure t (Paris), le total autorisé = plafond × (20 % + 80 % × part de la journée d'exploitation écoulée, 05 h -> 23 h).
export const PACE_START_MIN=5*60,PACE_END_MIN=23*60,PACE_BASE=0.2;
export function paceAllowed(cap,parisMinutes){
  const c=Number(cap)||0;if(c<=0)return 0;
  const f=Math.min(1,Math.max(0,((Number(parisMinutes)||0)-PACE_START_MIN)/(PACE_END_MIN-PACE_START_MIN)));
  return Math.min(c,Math.max(1,Math.ceil(c*(PACE_BASE+(1-PACE_BASE)*f)-1e-9)));
}
// Appels encore permis maintenant (0 = attendre). Le PUSH manuel de l'admin ignore l'étalement.
export function paceRoom(used,cap,parisMinutes){
  if(globalThis.__ALYZIA_MANUAL_PUSH)return Math.max(0,(Number(cap)||0)-(Number(used)||0));
  return Math.max(0,paceAllowed(cap,parisMinutes)-(Number(used)||0));
}
