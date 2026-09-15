import {extractSource} from './extract.js';
import {resolveIdentity} from './identity.js';
import {classifyDocument} from './classify.js';
import {interpretDocument} from './interpret.js';
import {consolidateFlight,validateFlight} from './consolidate.js';
import {ensureV3,storeRaw,fetchRaw,digest} from './store.js';

const parse = (value,fallback) => {try{return JSON.parse(value)}catch{return fallback}};

export async function processV3(env,id,adapters,hints={},depth=0){
  await ensureV3(env.OPS_DB);
  const {row,bytes}=await fetchRaw(env,id);
  let document,children=[];
  try{
    ({document,children}=await extractSource({bytes,filename:row.filename,mimeType:row.mime_type,adapters,depth}));
  }catch(error){
    const code=String(error.message||error);
    await env.OPS_DB.prepare(`INSERT INTO v3_extracted_documents(source_id,format,text_json,metadata_json,status,error_code) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET status=excluded.status,error_code=excluded.error_code,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,'ERROR','{}','{}','ERROR',code).run();
    return {id,status:'ERROR',issues:[code]};
  }
  await env.OPS_DB.prepare(`INSERT INTO v3_extracted_documents(source_id,format,text_json,metadata_json,status,error_code) VALUES(?,?,?,?,?,NULL) ON CONFLICT(source_id) DO UPDATE SET text_json=excluded.text_json,metadata_json=excluded.metadata_json,status=excluded.status,error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,document.format,JSON.stringify(document),JSON.stringify(document.metadata),'EXTRACTED').run();
  if(children.length){
    if(depth>=2)return {id,status:'REVIEW_REQUIRED',issues:['NESTING_LIMIT']};
    const results=[];
    for(const child of children){
      const saved=await storeRaw(env,{bytes:child.bytes,filename:child.filename,mimeType:child.mimeType||'application/octet-stream',sourceKind:'CHILD',sourceRef:id,parentId:id});
      results.push(await processV3(env,saved.id,adapters,hints,depth+1));
    }
    if(document.format==='ZIP')return {id,status:'EXPANDED',children:results};
    // EML body and attachments are independently classified, preserving provenance.
  }
  if(!document.text)return {id,status:'EXPANDED',children:children.length};
  const identity=resolveIdentity(document,hints),classification=classifyDocument(document);
  const interpreter=interpretDocument(document,identity,classification,adapters);
  const issues=[...identity.issues,...classification.issues,...interpreter.issues];
  const status=issues.length?'REVIEW_REQUIRED':'READY';
  await env.OPS_DB.prepare(`INSERT INTO v3_decisions(source_id,identity_json,classification_json,interpreter_json,status,issues_json) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET identity_json=excluded.identity_json,classification_json=excluded.classification_json,interpreter_json=excluded.interpreter_json,status=excluded.status,issues_json=excluded.issues_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(id,JSON.stringify(identity),JSON.stringify(classification),JSON.stringify(interpreter),status,JSON.stringify(issues)).run();
  return {id,status,identity,classification,issues,children:children.length};
}

export async function compareV3(env,flightIdentity,adapters){
  await ensureV3(env.OPS_DB);
  const rows=(await env.OPS_DB.prepare(`SELECT * FROM v3_decisions`).all()).results||[];
  const relevant=rows.filter(row=>parse(row.identity_json,{}).key===flightIdentity);
  const unresolved=relevant.filter(row=>row.status!=='READY').map(row=>row.source_id);
  const decisions=relevant.filter(row=>row.status==='READY').map(row=>({sourceId:row.source_id,identity:parse(row.identity_json,{}),
    classification:parse(row.classification_json,{}),interpreter:parse(row.interpreter_json,{cards:[]})}))
  const batch=consolidateFlight(decisions);
  if(unresolved.length)batch.issues.push('UNRESOLVED_DOCUMENTS');
  const existing=await adapters.getFlight(flightIdentity);
  if(!existing && !batch.cards.some(card=>card.type==='MASTER'))
    batch.issues.push('MASTER_REQUIRED_FOR_NEW_FLIGHT');
  const validation=validateFlight(batch);
  const comparison={v2Exists:!!existing,v2Passengers:(existing?.passengers||existing?.pax||[]).length,
    v3Passengers:batch.passengers.length,v3Cards:batch.cards.length,
    baselineHash:existing?await digest(new TextEncoder().encode(JSON.stringify((({ _serverUpdatedAt, ...data })=>data)(existing)))):null};
  const ids=decisions.map(d=>d.sourceId).sort(),fingerprint=await digest(new TextEncoder().encode(JSON.stringify(ids)));
  const batchId=`v3-${fingerprint}`;
  await env.OPS_DB.prepare(`INSERT INTO v3_flight_batches(batch_id,flight_identity,source_ids_json,consolidated_json,validation_json,comparison_json,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(batch_id) DO UPDATE SET consolidated_json=excluded.consolidated_json,validation_json=excluded.validation_json,comparison_json=excluded.comparison_json,status=CASE WHEN v3_flight_batches.status='APPLIED' THEN 'APPLIED' ELSE excluded.status END,updated_at=CURRENT_TIMESTAMP`)
    .bind(batchId,flightIdentity,JSON.stringify(ids),JSON.stringify(batch),JSON.stringify(validation),JSON.stringify(comparison),validation.status==='VALID'?'READY':'REVIEW_REQUIRED').run();
  return {batchId,flightIdentity,validation,comparison,sourceIds:ids,unresolved,consolidated:batch};
}
