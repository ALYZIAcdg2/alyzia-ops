// Mémorise le dernier refus d'un fournisseur (401/403/429) avec le message renvoyé par l'API, et met le fournisseur en pause
// après un 401/403 pour ne pas gaspiller un appel toutes les 5 minutes. Stockage : table ops_meta (clé "provider_err:<FOURNISSEUR>").
const PAUSE_MS=3*3600*1000;
const DOWN_PAUSE_MS=30*60*1000;
const clean=v=>String(v??"").trim();
const keyTag=key=>{const k=clean(key);return k?k.slice(-4):""};
async function ensure(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS ops_meta(k TEXT PRIMARY KEY,v TEXT)`).run()}
function messageOf(payload){
  if(payload==null)return "";
  const m=typeof payload==="string"?payload:(payload.message||payload.error||payload.detail||payload.msg||JSON.stringify(payload));
  return clean(typeof m==="string"?m:JSON.stringify(m)).slice(0,160);
}
// {paused:true,status,message,until} si le fournisseur est en pause ; une clé différente de celle qui a été refusée lève la pause.
export async function providerPause(env,provider,key){
  try{
    await ensure(env);
    const row=await env.OPS_DB.prepare(`SELECT v FROM ops_meta WHERE k=?`).bind("provider_err:"+provider).first();
    if(!row?.v)return {paused:false};
    const e=JSON.parse(row.v);
    if(!e.until||Date.parse(e.until)<=Date.now())return {paused:false};
    if(e.keyTag&&keyTag(key)&&e.keyTag!==keyTag(key))return {paused:false};
    return {paused:true,status:e.status,message:e.message,until:e.until};
  }catch(_){return {paused:false}}
}
export async function recordProviderResult(env,provider,status,payload,key){
  try{
    await ensure(env);const k="provider_err:"+provider;
    if(status>=200&&status<300){await env.OPS_DB.prepare(`DELETE FROM ops_meta WHERE k=?`).bind(k).run();return}
    // 401/403 : pause de 3 h (clé ou abonnement refusé) ; 5xx : pause de 30 min (fournisseur en panne) ; 429 : message seulement.
    if(![401,403,429].includes(status)&&!(status>=500&&status<600))return;
    const now=new Date(),pause=status>=500?DOWN_PAUSE_MS:PAUSE_MS,v={status,message:messageOf(payload)||("HTTP "+status+" (réponse vide ou illisible)"),at:now.toISOString(),keyTag:keyTag(key),until:status===429?"":new Date(now.getTime()+pause).toISOString()};
    await env.OPS_DB.prepare(`INSERT INTO ops_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind(k,JSON.stringify(v)).run();
  }catch(_){}
}
export async function readProviderErrors(env){
  const out={};
  try{
    await ensure(env);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT k,v FROM ops_meta WHERE k LIKE 'provider_err:%'`).all();
    for(const r of results){try{out[String(r.k).slice(13)]=JSON.parse(r.v)}catch(_){}}
  }catch(_){}
  return out;
}
