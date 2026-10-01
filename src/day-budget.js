// Budget journalier d'un fournisseur à quota mensuel : (quota utilisable - déjà consommé avant aujourd'hui) / jours restants du mois (aujourd'hui inclus).
// Évite d'épuiser le mois en quelques jours (ex. Airlabs 87 appels/jour pour 820 utilisables). Les appels de tous les "couloirs" (AIRLABS_*) comptent ensemble.
export function allowedToday(usable,usedBeforeToday,date){
  const m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return Math.max(1,Math.ceil(usable/31));
  const dim=new Date(Date.UTC(Number(m[1]),Number(m[2]),0)).getUTCDate(),left=Math.max(1,dim-Number(m[3])+1);
  return Math.max(1,Math.ceil(Math.max(0,usable-usedBeforeToday)/left));
}
function parisDate(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
// {allowed, usedToday, left}. share < 1 réserve une part du budget du jour à d'autres usages (ex. 0.5 pour les couloirs "STA/routes").
export async function dayBudget(env,prefix,usable,share=1){
  const date=parisDate(),month=date.slice(0,7);
  try{
    const {results=[]}=await env.OPS_DB.prepare(`SELECT period,SUM(calls) AS c FROM api_provider_usage WHERE provider LIKE ? AND period IN (?,?) GROUP BY period`).bind(prefix+"%",month,date).all();
    const m=Number(results.find(r=>r.period===month)?.c||0),d=Number(results.find(r=>r.period===date)?.c||0);
    const allowed=Math.max(1,Math.floor(allowedToday(usable,m-d,date)*share));
    return {allowed,usedToday:d,left:Math.max(0,allowed-d)};
  }catch(_){return {allowed:Infinity,usedToday:0,left:Infinity}}
}
