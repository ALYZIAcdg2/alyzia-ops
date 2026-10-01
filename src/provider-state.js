// État lisible de chaque fournisseur à son dernier passage du cron : actif, ou POURQUOI il n'a pas appelé (plafond, rythme, pause, aucun vol...).
// Affiché dans l'admin, sous la ligne HTTP du tableau « Provider Observability ». Stockage : ops_meta, clé "provider_state:<FOURNISSEUR>".
const clean=v=>String(v??"").trim();
const hm=iso=>{const m=clean(iso).match(/T(\d{2}:\d{2})/);return m?m[1]:""};
const lastWrite=new Map();

export function describeState(result,err){
  if(err)return {code:"ERREUR",label:"Erreur au dernier passage : "+clean(err?.message||err).slice(0,80)};
  if(!result)return {code:"INCONNU",label:"Aucun résultat"};
  const sk=clean(result.skipped);
  if(sk){
    const day=result.day,month=result.month;
    if(/_NON_CONFIGURE$|_API_KEY_NON_CONFIGURE$/.test(sk))return {code:sk,label:"Clé non configurée"};
    if(/_QUEUE_VIDE$|_AUCUN_VOL$|_AUCUN_VOL_QUEUE$|_AUCUN_CANDIDAT_QUEUE$/.test(sk))return {code:sk,label:"Aucun vol à traiter pour l'instant"};
    if(/_QUOTA_RESERVE$/.test(sk))return {code:sk,label:"Réserve du quota mensuel atteinte"};
    if(/_PLAFOND_JOUR$/.test(sk))return {code:sk,label:"Plafond du jour atteint"+(day!=null?" ("+day+" appels)":"")};
    if(/_QUOTA$/.test(sk))return {code:sk,label:"Plafond atteint"+(day!=null?" (aujourd'hui "+day+" · ce mois "+(month??"?")+")":"")};
    if(/_RYTHME$/.test(sk))return {code:sk,label:"Budget étalé sur la journée : prochain appel autorisé plus tard"};
    if(/_CADENCE$/.test(sk))return {code:sk,label:"Intervalle minimum entre deux appels (cadence)"};
    const p=sk.match(/_PAUSE_(\d{3})$/);
    if(p)return {code:sk,label:"En pause"+(result.until?" jusqu'à "+hm(result.until):"")+" (HTTP "+p[1]+")"+(result.message?" : "+clean(result.message).slice(0,70):"")};
    return {code:sk,label:sk};
  }
  const n=Array.isArray(result.items)?result.items.length:Array.isArray(result.results)?result.results.filter(r=>r&&r.ok!==false).length:Number(result.processed||0);
  if(n>0)return {code:"ACTIF",label:"Actif : "+n+" vol"+(n>1?"s":"")+" traité"+(n>1?"s":"")+" au dernier passage"};
  return {code:"RIEN",label:"Aucun vol traité au dernier passage"};
}
export async function recordProviderState(env,provider,result,err){
  try{
    const s=describeState(result,err),prev=lastWrite.get(provider);
    if(prev&&prev.label===s.label&&Date.now()-prev.t<10*60000)return;
    lastWrite.set(provider,{label:s.label,t:Date.now()});
    await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS ops_meta(k TEXT PRIMARY KEY,v TEXT)`).run();
    await env.OPS_DB.prepare(`INSERT INTO ops_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind("provider_state:"+provider,JSON.stringify({code:s.code,label:s.label,at:new Date().toISOString()})).run();
  }catch(_){}
}
export async function readProviderStates(env){
  const out={};
  try{
    const {results=[]}=await env.OPS_DB.prepare(`SELECT k,v FROM ops_meta WHERE k LIKE 'provider_state:%'`).all();
    for(const r of results){try{out[String(r.k).slice(15)]=JSON.parse(r.v)}catch(_){}}
  }catch(_){}
  return out;
}
