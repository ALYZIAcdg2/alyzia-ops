const clean=v=>String(v??"").trim();

async function ensure(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_enrichment_queue(
    flight_identity TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    provider TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    delta_minutes INTEGER,
    stop_all INTEGER NOT NULL DEFAULT 0,
    evaluated_at TEXT NOT NULL,
    PRIMARY KEY(flight_identity,provider)
  )`).run();
}

export async function queuedRows(env,provider,date){
  if(!env?.OPS_DB||!clean(provider)||!clean(date))return [];
  try{
    await ensure(env);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT flight_identity,fields_json,delta_minutes,evaluated_at FROM provider_enrichment_queue WHERE flight_date=? AND provider=? AND stop_all=0`).bind(date,provider).all();
    return results.map(r=>{let fields=[];try{fields=JSON.parse(r.fields_json||"[]")}catch{}return {...r,fields:Array.isArray(fields)?fields:[]}});
  }catch{return []}
}

export async function queuedIdentitySet(env,provider,date){
  const rows=await queuedRows(env,provider,date);
  return new Set(rows.map(r=>clean(r.flight_identity)).filter(Boolean));
}

export async function queuedFieldMap(env,provider,date){
  const rows=await queuedRows(env,provider,date),map=new Map();
  for(const row of rows)map.set(clean(row.flight_identity),new Set(row.fields||[]));
  return map;
}

export async function providerHasWork(env,provider,date){
  const rows=await queuedRows(env,provider,date);
  return rows.length>0;
}

export function fieldAllowed(fieldMap,identity,field){
  return Boolean(fieldMap?.get(clean(identity))?.has(field));
}
