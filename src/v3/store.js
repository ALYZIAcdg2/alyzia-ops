const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS v3_raw_sources (id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,r2_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,source_kind TEXT NOT NULL,source_ref TEXT,parent_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_v3_raw_sha ON v3_raw_sources(sha256)`,
  `CREATE TABLE IF NOT EXISTS v3_source_links (source_id TEXT NOT NULL,source_kind TEXT NOT NULL,source_ref TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_id,source_kind,source_ref))`,
  `CREATE TABLE IF NOT EXISTS v3_extracted_documents (source_id TEXT PRIMARY KEY,format TEXT NOT NULL,text_json TEXT NOT NULL,metadata_json TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS v3_decisions (source_id TEXT PRIMARY KEY,identity_json TEXT NOT NULL,classification_json TEXT NOT NULL,interpreter_json TEXT NOT NULL,status TEXT NOT NULL,issues_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS v3_flight_batches (batch_id TEXT PRIMARY KEY,flight_identity TEXT NOT NULL,source_ids_json TEXT NOT NULL,consolidated_json TEXT NOT NULL,validation_json TEXT NOT NULL,comparison_json TEXT NOT NULL,status TEXT NOT NULL,applied_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_v3_batch_flight ON v3_flight_batches(flight_identity,status)`
];
export async function ensureV3(db){await db.batch(SCHEMA.map(sql=>db.prepare(sql)))}
export const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(v=>v.toString(16).padStart(2,'0')).join('');

export async function storeRaw(env,{bytes,filename,mimeType='application/octet-stream',sourceKind='MANUAL',sourceRef='',parentId=''}){
  if(!env.OPS_FILES)throw new Error('R2_BINDING_MISSING');
  await ensureV3(env.OPS_DB);
  const sha=await digest(bytes), id=`raw-${sha}`, r2Key=`v3/raw/${sha}`;
  const existing=await env.OPS_DB.prepare('SELECT id FROM v3_raw_sources WHERE id=?').bind(id).first();
  if(!existing){
    await env.OPS_FILES.put(r2Key,bytes,{httpMetadata:{contentType:mimeType},customMetadata:{sha256:sha}});
    await env.OPS_DB.prepare(`INSERT INTO v3_raw_sources(id,sha256,r2_key,filename,mime_type,size_bytes,source_kind,source_ref,parent_id) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(id,sha,r2Key,filename,mimeType,bytes.length,sourceKind,sourceRef,parentId).run();
  }
  await env.OPS_DB.prepare('INSERT OR IGNORE INTO v3_source_links(source_id,source_kind,source_ref) VALUES(?,?,?)')
    .bind(id,sourceKind,sourceRef||filename).run();
  return {id,sha,duplicate:!!existing};
}

export async function fetchRaw(env,id){
  const row=await env.OPS_DB.prepare('SELECT * FROM v3_raw_sources WHERE id=?').bind(id).first();
  if(!row)throw new Error('SOURCE_NOT_FOUND');
  const object=await env.OPS_FILES.get(row.r2_key);
  if(!object)throw new Error('RAW_OBJECT_MISSING');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(await digest(bytes)!==row.sha256)throw new Error('RAW_HASH_MISMATCH');
  return {row,bytes};
}
