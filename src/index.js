// ALYZIA OPS V50.10 · LOT 2 Airline List Mapping
// - Assets statiques public/
// - API vols partagée D1
// - Bridge interne vers SARIA

const SARIA_PUBLIC_ORIGIN = "https://saria-seatmap.alyzia-cdg2.workers.dev";

function json(data,status=200,extraHeaders={}){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type, Authorization",
      "Cache-Control":"no-store",
      ...extraHeaders
    }
  });
}

function flightIdentity(x){
  return [
    String(x?.date||"").trim(),
    String(x?.airline||"").trim().toUpperCase(),
    String(x?.flight||"").trim().toUpperCase()
  ].join("|");
}

function validFlight(x){
  return x &&
    String(x.date||"").trim() &&
    String(x.airline||"").trim() &&
    String(x.flight||"").trim() &&
    String(x.airline||"").trim().toUpperCase()!=="KL";
}

async function getFlightsResponse(env){
  /*
   * V49.90 RESOURCE FIX
   * Les vols sont déjà stockés en JSON valide dans data_json.
   * On évite de JSON.parse() puis JSON.stringify() chaque vol,
   * ce qui consommait beaucoup de CPU lorsque D1 contenait
   * plusieurs dizaines de fiches volumineuses.
   */
  const {results=[]}=await env.OPS_DB
    .prepare(`SELECT data_json
              FROM flights
              ORDER BY flight_date, std, flight_number`)
    .all();

  const payload =
    `{"ok":true,"count":${results.length},"flights":[` +
    results
      .map(row => String(row.data_json || "{}"))
      .join(",") +
    `]}`;

  return new Response(payload,{
    status:200,
    headers:{
      "Content-Type":"application/json; charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type, Authorization",
      "Cache-Control":"no-store"
    }
  });
}

async function upsertFlight(env,x){
  if(!validFlight(x))return false;

  const identity=flightIdentity(x);
  await env.OPS_DB.prepare(`
    INSERT INTO flights
      (identity, flight_date, airline, flight_number, std, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(identity) DO UPDATE SET
      flight_date=excluded.flight_date,
      airline=excluded.airline,
      flight_number=excluded.flight_number,
      std=excluded.std,
      data_json=excluded.data_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    identity,
    String(x.date||""),
    String(x.airline||"").toUpperCase(),
    String(x.flight||"").toUpperCase(),
    String(x.std||""),
    JSON.stringify(x)
  ).run();

  return true;
}


function isPlainObject(v){
  return v && typeof v==="object" && !Array.isArray(v);
}

function deepMerge(base,patch){
  if(Array.isArray(patch))return patch;
  if(!isPlainObject(patch))return patch;

  const out=isPlainObject(base)?{...base}:{};
  for(const [k,v] of Object.entries(patch)){
    if(isPlainObject(v) && isPlainObject(out[k]))out[k]=deepMerge(out[k],v);
    else out[k]=v;
  }
  return out;
}

async function getFlightByIdentity(env,identity){
  const row=await env.OPS_DB.prepare(`
    SELECT data_json, updated_at
    FROM flights
    WHERE identity=?
    LIMIT 1
  `).bind(identity).first();

  if(!row)return null;
  try{
    const x=JSON.parse(row.data_json);
    x._serverUpdatedAt=row.updated_at||"";
    return x;
  }catch(e){
    return null;
  }
}

async function patchFlight(env,identity,patch){
  const current=await getFlightByIdentity(env,identity);
  if(!current)return null;

  // Identity fields are server authoritative for PATCH.
  const safePatch={...(patch||{})};
  delete safePatch.date;
  delete safePatch.airline;
  delete safePatch.flight;
  delete safePatch._serverUpdatedAt;

  const merged=deepMerge(current,safePatch);
  merged.date=current.date;
  merged.airline=current.airline;
  merged.flight=current.flight;

  await upsertFlight(env,merged);
  return await getFlightByIdentity(env,identity);
}

async function syncFlights(env,flights){
  const clean=[];
  const seen=new Set();

  for(const x of Array.isArray(flights)?flights:[]){
    if(!validFlight(x))continue;
    const id=flightIdentity(x);
    if(seen.has(id))continue;
    seen.add(id);
    clean.push(x);
  }

  // Batch par blocs pour rester robuste même avec un mois complet.
  const CHUNK=40;
  for(let i=0;i<clean.length;i+=CHUNK){
    const statements=clean.slice(i,i+CHUNK).map(x=>
      env.OPS_DB.prepare(`
        INSERT INTO flights
          (identity, flight_date, airline, flight_number, std, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(identity) DO UPDATE SET
          flight_date=excluded.flight_date,
          airline=excluded.airline,
          flight_number=excluded.flight_number,
          std=excluded.std,
          data_json=excluded.data_json,
          updated_at=CURRENT_TIMESTAMP
      `).bind(
        flightIdentity(x),
        String(x.date||""),
        String(x.airline||"").toUpperCase(),
        String(x.flight||"").toUpperCase(),
        String(x.std||""),
        JSON.stringify(x)
      )
    );
    if(statements.length)await env.OPS_DB.batch(statements);
  }

  return clean.length;
}

async function handleFlights(request,env,url){
  if(request.method==="OPTIONS")return json({ok:true});

  if(url.pathname==="/api/flights" && request.method==="GET"){
    const identity=String(url.searchParams.get("identity")||"").trim();
    if(identity){
      const flight=await getFlightByIdentity(env,identity);
      if(!flight)return json({ok:false,error:"VOL INTROUVABLE"},404);
      return json({ok:true,flight});
    }

    return await getFlightsResponse(env);
  }

  if(url.pathname==="/api/flights" && request.method==="POST"){
    const body=await request.json().catch(()=>null);
    if(!validFlight(body?.flight))return json({ok:false,error:"VOL INVALIDE"},400);
    await upsertFlight(env,body.flight);
    const identity=flightIdentity(body.flight);
    const flight=await getFlightByIdentity(env,identity);
    return json({ok:true,identity,flight});
  }

  if(url.pathname==="/api/flights" && request.method==="PATCH"){
    const body=await request.json().catch(()=>null);
    const identity=String(body?.identity||"").trim();
    const patch=body?.patch;
    if(!identity || !patch || typeof patch!=="object"){
      return json({ok:false,error:"IDENTITY OU PATCH MANQUANT"},400);
    }

    const flight=await patchFlight(env,identity,patch);
    if(!flight)return json({ok:false,error:"VOL INTROUVABLE"},404);
    return json({ok:true,identity,flight});
  }

  if(url.pathname==="/api/flights/sync" && request.method==="POST"){
    const body=await request.json().catch(()=>null);
    if(!Array.isArray(body?.flights))return json({ok:false,error:"LISTE VOLS MANQUANTE"},400);
    const count=await syncFlights(env,body.flights);
    return json({ok:true,count});
  }

  if(url.pathname==="/api/flights" && request.method==="DELETE"){
    await env.OPS_DB.prepare("DELETE FROM flights").run();
    return json({ok:true,cleared:true});
  }

  return null;
}

function isAuthorizedPrepa(request, env) {
  const expected = String(env.ALYZIA_API_SECRET || "").trim();

  if (!expected) return false;

  const auth = String(
    request.headers.get("Authorization") || ""
  ).trim();

  if (!auth.startsWith("Bearer ")) return false;

  const supplied = auth.slice(7).trim();

  return supplied === expected;
}


function normalizePrepaPayload(body) {
  if (!body || typeof body !== "object") return null;

  const gmail = body.gmail || {};
  const flight = body.flight || {};
  const email = body.email || {};
  const drive = body.drive || {};
  const detection = body.detection || {};

  const gmailMessageId =
    String(gmail.messageId || "").trim();

  if (!gmailMessageId) return null;

  const source =
    String(body.source || "GMAIL")
      .trim()
      .toUpperCase();

  const airline =
    String(flight.airline || "")
      .trim()
      .toUpperCase();

  const flightNumber =
    String(flight.flightNumber || "")
      .trim()
      .toUpperCase();

  const flightDate =
    String(flight.date || "").trim();

  const detectionStatus =
    String(detection.status || "")
      .trim()
      .toUpperCase();

  const attachments =
    Array.isArray(body.attachments)
      ? body.attachments
      : [];

  /*
   * IMPORT IDENTIFIÉ :
   * compagnie + vol + date obligatoires.
   */
  const identified =
    !!airline &&
    !!flightNumber &&
    !!flightDate;

  /*
   * IMPORT NON IDENTIFIÉ :
   * accepté uniquement si le script central l'annonce
   * explicitement ET s'il existe au moins une pièce jointe.
   *
   * Cela évite qu'un mail banal sans vol soit injecté.
   */
  const unidentified =
    !identified &&
    (
      detectionStatus === "UNIDENTIFIED" ||
      source === "GMAIL_UNIDENTIFIED"
    ) &&
    attachments.length > 0;

  if (!identified && !unidentified) {
    return null;
  }

  return {
    gmailMessageId,

    gmailThreadId:
      String(gmail.threadId || "").trim(),

    source:
      source || "GMAIL",

    detectionStatus:
      identified ? "IDENTIFIED" : "UNIDENTIFIED",

    airline:
      identified ? airline : "",

    flightNumber:
      identified ? flightNumber : "",

    flightDate:
      identified ? flightDate : "",

    subject:
      String(gmail.subject || ""),

    sender:
      String(gmail.from || ""),

    receivedAt:
      String(gmail.receivedAt || ""),

    bodyText:
      String(email.plainText || ""),

    driveFolderId:
      String(drive.folderId || ""),

    driveEmailPdfId:
      String(drive.emailPdfId || ""),

    attachments
  };
}


function defaultImportModeForAirline(airline){
  const code=String(airline||"").trim().toUpperCase();
  return ["SQ","TK","BJ"].includes(code) ? "SPECIFIC" : "GENERIC";
}

async function ensureAirlineProfile(env,airline){
  const code=String(airline||"").trim().toUpperCase();
  if(!code)return null;

  const mode=defaultImportModeForAirline(code);

  await env.OPS_DB.prepare(`
    INSERT OR IGNORE INTO airline_profiles
      (airline, import_mode, visible_kpis_json, visible_cards_json,
       notes_enabled, attachments_enabled, updated_at)
    VALUES (?, ?, '{}', '{}', 1, 1, CURRENT_TIMESTAMP)
  `).bind(code,mode).run();

  return await env.OPS_DB.prepare(`
    SELECT
      airline,
      import_mode,
      visible_kpis_json,
      visible_cards_json,
      notes_enabled,
      attachments_enabled,
      updated_at
    FROM airline_profiles
    WHERE airline=?
    LIMIT 1
  `).bind(code).first();
}

function safeJsonParse(value,fallback){
  try{
    const parsed=JSON.parse(String(value??""));
    return parsed;
  }catch(e){
    return fallback;
  }
}

async function getAirlineProfiles(env){
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT
      airline,
      import_mode,
      visible_kpis_json,
      visible_cards_json,
      notes_enabled,
      attachments_enabled,
      updated_at
    FROM airline_profiles
    ORDER BY airline
  `).all();

  return results.map(row=>({
    airline:String(row.airline||"").toUpperCase(),
    importMode:String(row.import_mode||"GENERIC").toUpperCase(),
    visibleKpis:safeJsonParse(row.visible_kpis_json,"{}"),
    visibleCards:safeJsonParse(row.visible_cards_json,"{}"),
    notesEnabled:Number(row.notes_enabled)!==0,
    attachmentsEnabled:Number(row.attachments_enabled)!==0,
    updatedAt:row.updated_at||""
  }));
}

async function handleAirlineProfiles(request,env,url){
  if(!url.pathname.startsWith("/api/airline-profiles"))return null;
  if(request.method==="OPTIONS")return json({ok:true});

  if(url.pathname==="/api/airline-profiles" && request.method==="GET"){
    const airline=String(url.searchParams.get("airline")||"").trim().toUpperCase();

    if(airline){
      const row=await ensureAirlineProfile(env,airline);
      if(!row)return json({ok:false,error:"COMPAGNIE INVALIDE"},400);

      return json({
        ok:true,
        profile:{
          airline:String(row.airline||"").toUpperCase(),
          importMode:String(row.import_mode||"GENERIC").toUpperCase(),
          visibleKpis:safeJsonParse(row.visible_kpis_json,{}),
          visibleCards:safeJsonParse(row.visible_cards_json,{}),
          notesEnabled:Number(row.notes_enabled)!==0,
          attachmentsEnabled:Number(row.attachments_enabled)!==0,
          updatedAt:row.updated_at||""
        }
      });
    }

    const profiles=await getAirlineProfiles(env);
    return json({ok:true,count:profiles.length,profiles});
  }

  /*
   * Écriture préparée pour V50.
   * Protégée temporairement par ALYZIA_API_SECRET jusqu'à l'étape AUTH.
   */
  if(url.pathname==="/api/airline-profiles" && request.method==="PATCH"){
    if(!isAuthorizedPrepa(request,env)){
      return json({ok:false,error:"NON AUTORISE"},401);
    }

    const body=await request.json().catch(()=>null);
    const airline=String(body?.airline||"").trim().toUpperCase();
    if(!airline)return json({ok:false,error:"COMPAGNIE MANQUANTE"},400);

    await ensureAirlineProfile(env,airline);

    const sets=[];
    const binds=[];

    if(body?.importMode!==undefined){
      const mode=String(body.importMode||"").trim().toUpperCase();
      if(!["GENERIC","SPECIFIC"].includes(mode)){
        return json({ok:false,error:"MODE IMPORT INVALIDE"},400);
      }
      sets.push("import_mode=?");
      binds.push(mode);
    }

    if(body?.visibleKpis!==undefined){
      sets.push("visible_kpis_json=?");
      binds.push(JSON.stringify(body.visibleKpis||{}));
    }

    if(body?.visibleCards!==undefined){
      sets.push("visible_cards_json=?");
      binds.push(JSON.stringify(body.visibleCards||{}));
    }

    if(body?.notesEnabled!==undefined){
      sets.push("notes_enabled=?");
      binds.push(body.notesEnabled?1:0);
    }

    if(body?.attachmentsEnabled!==undefined){
      sets.push("attachments_enabled=?");
      binds.push(body.attachmentsEnabled?1:0);
    }

    if(!sets.length)return json({ok:false,error:"AUCUNE MODIFICATION"},400);

    sets.push("updated_at=CURRENT_TIMESTAMP");
    binds.push(airline);

    await env.OPS_DB.prepare(`
      UPDATE airline_profiles
      SET ${sets.join(", ")}
      WHERE airline=?
    `).bind(...binds).run();

    const row=await ensureAirlineProfile(env,airline);

    return json({
      ok:true,
      profile:{
        airline:String(row.airline||"").toUpperCase(),
        importMode:String(row.import_mode||"GENERIC").toUpperCase(),
        visibleKpis:safeJsonParse(row.visible_kpis_json,{}),
        visibleCards:safeJsonParse(row.visible_cards_json,{}),
        notesEnabled:Number(row.notes_enabled)!==0,
        attachmentsEnabled:Number(row.attachments_enabled)!==0,
        updatedAt:row.updated_at||""
      }
    });
  }

  return json({ok:false,error:"ROUTE PROFIL COMPAGNIE INTROUVABLE"},404);
}

function sanitizeR2Segment(value){
  return String(value||"")
    .replace(/[^A-Za-z0-9._-]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,120) || "file";
}

function decodeBase64ToUint8Array(base64){
  const binary=atob(String(base64||""));
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

async function handleFlightNotes(request,env,url){
  if(!url.pathname.startsWith("/api/flight-notes") &&
     !url.pathname.startsWith("/api/flight-attachments")){
    return null;
  }

  if(request.method==="OPTIONS")return json({ok:true});

  /*
   * Lecture libre pour l'instant comme le reste de V49.x.
   * Les restrictions par rôle arriveront à l'étape AUTH.
   */
  if(url.pathname==="/api/flight-notes" && request.method==="GET"){
    const identity=String(url.searchParams.get("identity")||"").trim();
    if(!identity)return json({ok:false,error:"IDENTITY MANQUANTE"},400);

    const {results=[]}=await env.OPS_DB.prepare(`
      SELECT
        id, flight_identity, airline, note_type, content,
        created_by, created_at, updated_at
      FROM flight_notes
      WHERE flight_identity=?
      ORDER BY created_at DESC, id DESC
    `).bind(identity).all();

    return json({ok:true,count:results.length,notes:results});
  }

  if(url.pathname==="/api/flight-notes" && request.method==="POST"){
    if(!isAuthorizedPrepa(request,env)){
      return json({ok:false,error:"NON AUTORISE"},401);
    }

    const body=await request.json().catch(()=>null);
    const identity=String(body?.flightIdentity||"").trim();
    const airline=String(body?.airline||"").trim().toUpperCase();
    const content=String(body?.content||"").trim();
    const noteType=String(body?.noteType||"COMPANY").trim().toUpperCase();
    const createdBy=String(body?.createdBy||"").trim();

    if(!identity||!airline||!content){
      return json({ok:false,error:"NOTE INVALIDE"},400);
    }

    const result=await env.OPS_DB.prepare(`
      INSERT INTO flight_notes
        (flight_identity, airline, note_type, content, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(identity,airline,noteType,content,createdBy).run();

    return json({ok:true,id:Number(result.meta?.last_row_id||0)});
  }

  if(url.pathname==="/api/flight-attachments" && request.method==="GET"){
    const identity=String(url.searchParams.get("identity")||"").trim();
    if(!identity)return json({ok:false,error:"IDENTITY MANQUANTE"},400);

    const {results=[]}=await env.OPS_DB.prepare(`
      SELECT
        id, flight_identity, airline, note_id,
        file_name, original_file_name, mime_type, file_size,
        r2_key, uploaded_by, created_at
      FROM flight_attachments
      WHERE flight_identity=?
      ORDER BY created_at DESC, id DESC
    `).bind(identity).all();

    return json({ok:true,count:results.length,attachments:results});
  }

  if(url.pathname==="/api/flight-attachments" && request.method==="POST"){
    if(!isAuthorizedPrepa(request,env)){
      return json({ok:false,error:"NON AUTORISE"},401);
    }
    if(!env.OPS_FILES)return json({ok:false,error:"BINDING R2 OPS_FILES ABSENT"},500);

    const body=await request.json().catch(()=>null);
    const identity=String(body?.flightIdentity||"").trim();
    const airline=String(body?.airline||"").trim().toUpperCase();
    const originalFileName=String(body?.fileName||"").trim();
    const mimeType=String(body?.mimeType||"application/octet-stream").trim();
    const base64=String(body?.base64||"");
    const uploadedBy=String(body?.uploadedBy||"").trim();
    const noteId=body?.noteId===null||body?.noteId===undefined
      ? null
      : Number(body.noteId);

    if(!identity||!airline||!originalFileName||!base64){
      return json({ok:false,error:"PIECE JOINTE INVALIDE"},400);
    }

    const bytes=decodeBase64ToUint8Array(base64);
    const MAX_BYTES=12*1024*1024;
    if(bytes.byteLength>MAX_BYTES){
      return json({ok:false,error:"FICHIER TROP VOLUMINEUX (MAX 12 MB)"},413);
    }

    const allowedMime=new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]);

    if(!allowedMime.has(mimeType)){
      return json({ok:false,error:"TYPE DE FICHIER NON AUTORISE"},415);
    }

    const datePart=new Date().toISOString().slice(0,10);
    const unique=crypto.randomUUID();
    const safeName=sanitizeR2Segment(originalFileName);
    const safeIdentity=sanitizeR2Segment(identity);
    const r2Key=`flights/${safeIdentity}/notes/${datePart}/${unique}_${safeName}`;

    await env.OPS_FILES.put(r2Key,bytes,{
      httpMetadata:{contentType:mimeType},
      customMetadata:{
        airline,
        flightIdentity:identity,
        uploadedBy:uploadedBy.slice(0,120)
      }
    });

    const result=await env.OPS_DB.prepare(`
      INSERT INTO flight_attachments
        (flight_identity, airline, note_id, file_name, original_file_name,
         mime_type, file_size, r2_key, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      identity,
      airline,
      Number.isFinite(noteId)?noteId:null,
      safeName,
      originalFileName,
      mimeType,
      bytes.byteLength,
      r2Key,
      uploadedBy
    ).run();

    return json({
      ok:true,
      id:Number(result.meta?.last_row_id||0),
      r2Key,
      fileName:originalFileName,
      size:bytes.byteLength
    });
  }

  const attachmentMatch=url.pathname.match(/^\/api\/flight-attachments\/(\d+)$/);

  if(attachmentMatch && request.method==="GET"){
    const id=Number(attachmentMatch[1]);
    const row=await env.OPS_DB.prepare(`
      SELECT id, file_name, original_file_name, mime_type, r2_key
      FROM flight_attachments
      WHERE id=?
      LIMIT 1
    `).bind(id).first();

    if(!row)return json({ok:false,error:"PIECE JOINTE INTROUVABLE"},404);
    if(!env.OPS_FILES)return json({ok:false,error:"BINDING R2 OPS_FILES ABSENT"},500);

    const object=await env.OPS_FILES.get(row.r2_key);
    if(!object)return json({ok:false,error:"FICHIER R2 INTROUVABLE"},404);

    const headers=new Headers();
    headers.set("Content-Type",row.mime_type||object.httpMetadata?.contentType||"application/octet-stream");
    headers.set(
      "Content-Disposition",
      `inline; filename="${String(row.original_file_name||row.file_name||"file").replace(/"/g,"")}"`);
    headers.set("Cache-Control","private, no-store");
    headers.set("Access-Control-Allow-Origin","*");

    return new Response(object.body,{status:200,headers});
  }

  if(attachmentMatch && request.method==="DELETE"){
    if(!isAuthorizedPrepa(request,env)){
      return json({ok:false,error:"NON AUTORISE"},401);
    }

    const id=Number(attachmentMatch[1]);
    const row=await env.OPS_DB.prepare(`
      SELECT id, r2_key
      FROM flight_attachments
      WHERE id=?
      LIMIT 1
    `).bind(id).first();

    if(!row)return json({ok:false,error:"PIECE JOINTE INTROUVABLE"},404);

    if(env.OPS_FILES)await env.OPS_FILES.delete(row.r2_key);
    await env.OPS_DB.prepare("DELETE FROM flight_attachments WHERE id=?").bind(id).run();

    return json({ok:true,deleted:true,id});
  }

  return json({ok:false,error:"ROUTE NOTES/PIECES JOINTES INTROUVABLE"},404);
}

async function savePrepaInbox(env, item) {

  if(item?.airline){
    await ensureAirlineProfile(env,item.airline);
  }

  const attachmentsJson =
    JSON.stringify(item.attachments || []);

  const initialStatus =
    item.detectionStatus === "UNIDENTIFIED"
      ? "UNIDENTIFIED"
      : "PENDING";

  await env.OPS_DB.prepare(`
    INSERT INTO prepa_inbox (
      gmail_message_id,
      gmail_thread_id,

      source,

      airline,
      flight_number,
      flight_date,

      subject,
      sender,
      received_at,

      body_text,

      drive_folder_id,
      drive_email_pdf_id,

      attachments_json,

      status,
      error_message,
      updated_at
    )

    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '',
      CURRENT_TIMESTAMP
    )

    ON CONFLICT(gmail_message_id)
    DO UPDATE SET

      gmail_thread_id=excluded.gmail_thread_id,

      source=excluded.source,

      airline=excluded.airline,
      flight_number=excluded.flight_number,
      flight_date=excluded.flight_date,

      subject=excluded.subject,
      sender=excluded.sender,
      received_at=excluded.received_at,

      body_text=excluded.body_text,

      drive_folder_id=excluded.drive_folder_id,
      drive_email_pdf_id=excluded.drive_email_pdf_id,

      attachments_json=excluded.attachments_json,

      /*
       * Ne jamais remettre à PENDING un import déjà finalisé.
       * En revanche un ancien UNIDENTIFIED peut devenir PENDING
       * si le même message est renvoyé ensuite avec vol/date trouvés.
       */
      status=
        CASE
          WHEN prepa_inbox.status='PROCESSED'
            THEN 'PROCESSED'
          WHEN excluded.status='PENDING'
            THEN 'PENDING'
          ELSE excluded.status
        END,

      error_message=
        CASE
          WHEN excluded.status='PENDING'
            THEN ''
          ELSE prepa_inbox.error_message
        END,

      updated_at=CURRENT_TIMESTAMP
  `).bind(
    item.gmailMessageId,
    item.gmailThreadId,

    item.source,

    item.airline,
    item.flightNumber,
    item.flightDate,

    item.subject,
    item.sender,
    item.receivedAt,

    item.bodyText,

    item.driveFolderId,
    item.driveEmailPdfId,

    attachmentsJson,

    initialStatus
  ).run();

  return initialStatus;
}

async function getPrepaInbox(env, url) {

  const status =
    String(
      url.searchParams.get("status") || ""
    )
      .trim()
      .toUpperCase();

  const airline =
    String(
      url.searchParams.get("airline") || ""
    )
      .trim()
      .toUpperCase();

  const flightNumber =
    String(
      url.searchParams.get("flight") || ""
    )
      .trim()
      .toUpperCase();

  /*
   * V50.4 — sur demande explicite de l'interface, renvoyer aussi
   * les payloads base64 des pièces jointes même si l'import est PROCESSED/ERROR.
   * Utilisé uniquement pour REPRENDRE / RÉINJECTER.
   */
  const includePayload =
    String(url.searchParams.get("includePayload") || "") === "1";


  let sql = `
    SELECT
      id,
      gmail_message_id,
      gmail_thread_id,

      source,

      airline,
      flight_number,
      flight_date,

      subject,
      sender,
      received_at,

      body_text,

      drive_folder_id,
      drive_email_pdf_id,

      attachments_json,

      status,
      error_message,

      created_at,
      updated_at,
      processed_at

    FROM prepa_inbox

    WHERE 1=1
  `;

  const binds = [];


  if (status) {
    sql += ` AND status=?`;
    binds.push(status);
  }


  if (airline) {
    sql += ` AND airline=?`;
    binds.push(airline);
  }


  if (flightNumber) {
    sql += ` AND flight_number=?`;
    binds.push(flightNumber);
  }


  sql += `
    ORDER BY received_at DESC, id DESC
    LIMIT 120
  `;


  const statement =
    env.OPS_DB.prepare(sql);

  const result =
    binds.length
      ? await statement.bind(...binds).all()
      : await statement.all();


  const rows =
    Array.isArray(result.results)
      ? result.results
      : [];


  const items =
    rows.map(row => {

      let attachments = [];

      try {
        const parsed =
          JSON.parse(
            row.attachments_json || "[]"
          );

        const needsPayload =
          includePayload ||
          status === "PENDING" ||
          status === "PROCESSING" ||
          status === "UNIDENTIFIED";

        attachments =
          Array.isArray(parsed)
            ? parsed.map(att => {
                if (needsPayload) return att;

                /*
                 * Vue OUTILS / historique :
                 * on ne renvoie pas les PDF base64.
                 * Seulement les métadonnées nécessaires à l'interface.
                 */
                return {
                  name: String(att?.name || ""),
                  mimeType: String(att?.mimeType || ""),
                  size: Number(att?.size || 0),
                  driveId: String(att?.driveId || "")
                };
              })
            : [];
      } catch (e) {}


      return {
        id: row.id,

        gmailMessageId:
          row.gmail_message_id,

        gmailThreadId:
          row.gmail_thread_id,

        source:
          row.source ||
          (
            String(row.gmail_message_id || "")
              .startsWith("HISTO_PREPASQ_")
              ? "HISTORIQUE_PREPASQ"
              : "GMAIL"
          ),

        airline:
          row.airline,

        flightNumber:
          row.flight_number,

        flightDate:
          row.flight_date,

        subject:
          row.subject,

        sender:
          row.sender,

        receivedAt:
          row.received_at,

        bodyText:
          row.body_text,

        driveFolderId:
          row.drive_folder_id,

        driveEmailPdfId:
          row.drive_email_pdf_id,

        attachments,

        status:
          row.status,

        errorMessage:
          row.error_message,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        processedAt:
          row.processed_at
      };

    });


  return items;
}



/* =========================================================
   V50.5 — GOOGLE DRIVE DIRECT + NEUTRALISATION + REPAIR
   ========================================================= */

async function ensurePrepaControlTables(env){
  await env.OPS_DB.batch([
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_integrations (
        integration_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS prepa_suppressed_flights (
        airline TEXT NOT NULL,
        flight_number TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (airline, flight_number, flight_date)
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS prepa_suppressed_messages (
        gmail_message_id TEXT PRIMARY KEY,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]);
}

async function getIntegrationJson(env,key){
  await ensurePrepaControlTables(env);
  const row=await env.OPS_DB.prepare(`
    SELECT value_json FROM app_integrations
    WHERE integration_key=?
    LIMIT 1
  `).bind(key).first();
  if(!row)return null;
  try{return JSON.parse(row.value_json||"{}")}catch(e){return null}
}

async function setIntegrationJson(env,key,value){
  await ensurePrepaControlTables(env);
  await env.OPS_DB.prepare(`
    INSERT INTO app_integrations
      (integration_key,value_json,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(integration_key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(key,JSON.stringify(value||{})).run();
}

function googleDriveRedirectUri(request){
  const u=new URL(request.url);
  return `${u.origin}/api/prepa/google-drive/oauth/callback`;
}

async function googleDriveStatus(env){
  const cfg=await getIntegrationJson(env,"google_drive_oauth");
  return {
    configured:!!String(cfg?.refresh_token||"").trim(),
    oauthClientConfigured:
      !!String(env.GOOGLE_CLIENT_ID||"").trim() &&
      !!String(env.GOOGLE_CLIENT_SECRET||"").trim(),
    connectedEmail:String(cfg?.email||""),
    connectedAt:String(cfg?.connected_at||"")
  };
}

async function getGoogleDriveAccessToken(env){
  const cfg=await getIntegrationJson(env,"google_drive_oauth");
  const refreshToken=String(cfg?.refresh_token||"").trim();
  const clientId=String(env.GOOGLE_CLIENT_ID||"").trim();
  const clientSecret=String(env.GOOGLE_CLIENT_SECRET||"").trim();

  if(!refreshToken||!clientId||!clientSecret){
    throw new Error("GOOGLE DRIVE DIRECT NON CONFIGURÉ");
  }

  const form=new URLSearchParams({
    client_id:clientId,
    client_secret:clientSecret,
    refresh_token:refreshToken,
    grant_type:"refresh_token"
  });

  const resp=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:form.toString()
  });

  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||!data?.access_token){
    throw new Error(data?.error_description||data?.error||`GOOGLE TOKEN HTTP ${resp.status}`);
  }
  return String(data.access_token);
}

async function trashDriveFoldersDirect(env,folderIds){
  const ids=[...new Set((folderIds||[]).map(x=>String(x||"").trim()).filter(Boolean))];
  if(!ids.length)return {ok:true,trashed:[],missing:[],errors:[]};

  const accessToken=await getGoogleDriveAccessToken(env);
  const trashed=[],missing=[],errors=[];

  for(const id of ids){
    const resp=await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,
      {
        method:"PATCH",
        headers:{
          "Authorization":`Bearer ${accessToken}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({trashed:true})
      }
    );

    if(resp.status===404){
      missing.push(id);
      continue;
    }

    if(!resp.ok){
      const data=await resp.json().catch(()=>({}));
      errors.push({
        id,
        status:resp.status,
        error:data?.error?.message||`HTTP ${resp.status}`
      });
      continue;
    }

    trashed.push(id);
  }

  return {ok:errors.length===0,trashed,missing,errors};
}

async function isPrepaSuppressed(env,item){
  await ensurePrepaControlTables(env);

  const gmailMessageId=String(item?.gmailMessageId||"").trim();
  if(gmailMessageId){
    const m=await env.OPS_DB.prepare(`
      SELECT gmail_message_id
      FROM prepa_suppressed_messages
      WHERE gmail_message_id=?
      LIMIT 1
    `).bind(gmailMessageId).first();
    if(m)return {suppressed:true,reason:"MESSAGE"};
  }

  const airline=String(item?.airline||"").trim().toUpperCase();
  const flightNumber=String(item?.flightNumber||"").replace(/\s+/g,"").trim().toUpperCase();
  const flightDate=String(item?.flightDate||"").trim();

  if(airline&&flightNumber&&flightDate){
    const f=await env.OPS_DB.prepare(`
      SELECT airline
      FROM prepa_suppressed_flights
      WHERE airline=? AND flight_number=? AND flight_date=?
      LIMIT 1
    `).bind(airline,flightNumber,flightDate).first();
    if(f)return {suppressed:true,reason:"FLIGHT"};
  }

  return {suppressed:false};
}

async function suppressPrepaFlight(env,{airline,flightNumber,flightDate,prepaRows}){
  await ensurePrepaControlTables(env);

  await env.OPS_DB.prepare(`
    INSERT INTO prepa_suppressed_flights
      (airline,flight_number,flight_date,reason,created_at)
    VALUES (?,?,?,'DELETE_FROM_ALYZIA',CURRENT_TIMESTAMP)
    ON CONFLICT(airline,flight_number,flight_date) DO UPDATE SET
      reason='DELETE_FROM_ALYZIA',
      created_at=CURRENT_TIMESTAMP
  `).bind(airline,flightNumber,flightDate).run();

  for(const row of prepaRows||[]){
    const msg=String(row?.gmail_message_id||"").trim();
    if(!msg)continue;
    await env.OPS_DB.prepare(`
      INSERT INTO prepa_suppressed_messages
        (gmail_message_id,airline,flight_number,flight_date,created_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(gmail_message_id) DO UPDATE SET
        airline=excluded.airline,
        flight_number=excluded.flight_number,
        flight_date=excluded.flight_date,
        created_at=CURRENT_TIMESTAMP
    `).bind(msg,airline,flightNumber,flightDate).run();
  }
}

async function repairPrepaScope(env,body){
  await ensurePrepaControlTables(env);

  const scope=String(body?.scope||"").trim().toUpperCase();
  const airline=String(body?.airline||"").trim().toUpperCase();
  const flightNumber=String(body?.flightNumber||"").replace(/\s+/g,"").trim().toUpperCase();
  const flightDate=String(body?.flightDate||"").trim();

  let where="1=1";
  const binds=[];

  if(scope==="FLIGHT"){
    if(!airline||!flightNumber||!flightDate)throw new Error("VOL / COMPAGNIE / DATE MANQUANTS");
    where+=` AND UPPER(airline)=? AND UPPER(REPLACE(flight_number,' ',''))=? AND flight_date=?`;
    binds.push(airline,flightNumber,flightDate);
  }else if(scope==="AIRLINE"){
    if(!airline)throw new Error("COMPAGNIE MANQUANTE");
    where+=` AND UPPER(airline)=?`;
    binds.push(airline);
  }else if(scope!=="ALL"){
    throw new Error("SCOPE REPAIR INVALIDE");
  }

  where+=`
    AND NOT EXISTS (
      SELECT 1
      FROM prepa_suppressed_flights s
      WHERE s.airline=UPPER(prepa_inbox.airline)
        AND s.flight_number=UPPER(REPLACE(prepa_inbox.flight_number,' ',''))
        AND s.flight_date=prepa_inbox.flight_date
    )
    AND NOT EXISTS (
      SELECT 1
      FROM prepa_suppressed_messages sm
      WHERE sm.gmail_message_id=prepa_inbox.gmail_message_id
    )
  `;

  const sql=`
    UPDATE prepa_inbox
    SET
      status='PENDING',
      error_message='',
      processed_at=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE ${where}
  `;

  const result=await env.OPS_DB.prepare(sql).bind(...binds).run();

  return {
    scope,
    airline,
    flightNumber,
    flightDate,
    affected:Number(result.meta?.changes||0)
  };
}

function googleCallbackHtml(ok,message){
  const safe=String(message||"").replace(/[&<>"]/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[c]));
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ALYZIA OPS · Google Drive</title>
  <style>
  body{font-family:Arial,sans-serif;background:#f4f7fb;color:#10213b;margin:0;display:grid;place-items:center;min-height:100vh}
  .box{background:#fff;border:1px solid #dbe6f2;border-radius:20px;padding:28px;max-width:520px;box-shadow:0 18px 55px #1232}
  h1{margin:0 0 10px;font-size:24px}.ok{color:#16803a}.err{color:#b42318}
  a{display:inline-block;margin-top:18px;background:#0b73e0;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:800}
  </style></head><body><div class="box"><h1 class="${ok?"ok":"err"}">${ok?"GOOGLE DRIVE CONNECTÉ":"CONNEXION DRIVE IMPOSSIBLE"}</h1><p>${safe}</p><a href="/">RETOUR À ALYZIA OPS</a></div></body></html>`,{
    status:ok?200:400,
    headers:{"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}
  });
}

/* =========================================================
   V50.6 LOT 1 — GMAIL API INTAKE FOUNDATION
   - Apps Script remplacé par Gmail API côté Worker
   - Stocke tout type de pièce jointe dans R2
   - Indexe messages/fichiers/versions dans D1
   - Ne touche pas aux parsers SQ/TK/BJ/TW
   - Pas encore de parsing métier : intake + historique + labels
   ========================================================= */

const GMAIL_API_BASE="https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_LABELS={
  RECEIVED:"ALYZIA/REÇU",
  IMPORTED:"ALYZIA/IMPORTÉ",
  UPDATED:"ALYZIA/MIS_A_JOUR",
  DUPLICATE:"ALYZIA/IGNORÉ_DOUBLON",
  ERROR:"ALYZIA/ERREUR",
  SUPPRESSED:"ALYZIA/SUPPRIMÉ_NEUTRALISÉ"
};

async function ensureGmailPipelineTables(env){
  await ensurePrepaControlTables(env);
  await env.OPS_DB.batch([
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS gmail_sync_state (
        mailbox TEXT PRIMARY KEY,
        last_history_id TEXT,
        last_full_sync_at TEXT,
        last_realtime_sync_at TEXT,
        backfill_query TEXT,
        backfill_page_token TEXT,
        backfill_status TEXT NOT NULL DEFAULT 'IDLE',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS gmail_messages (
        gmail_message_id TEXT PRIMARY KEY,
        gmail_thread_id TEXT,
        history_id TEXT,
        internal_date TEXT,
        subject TEXT,
        sender TEXT,
        received_at TEXT,
        snippet TEXT,
        label_state TEXT,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS import_files (
        file_id TEXT PRIMARY KEY,
        active_version_id TEXT,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        document_type TEXT,
        filename_normalized TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        latest_document_time TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        retention_status TEXT NOT NULL DEFAULT 'ACTIVE',
        locked_until TEXT,
        deleted_at TEXT
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS import_file_versions (
        version_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        gmail_message_id TEXT,
        attachment_id TEXT,
        filename_original TEXT,
        filename_normalized TEXT,
        mime_type TEXT,
        file_size INTEGER,
        sha256 TEXT,
        r2_key TEXT,
        document_time TEXT,
        received_at TEXT,
        status TEXT NOT NULL DEFAULT 'STORED',
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS import_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        gmail_message_id TEXT,
        file_id TEXT,
        version_id TEXT,
        change_type TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 50,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        file_id TEXT,
        version_id TEXT,
        gmail_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        run_after TEXT
      )
    `)
  ]);
}

function gmailRedirectUri(request){
  const u=new URL(request.url);
  return `${u.origin}/api/gmail/oauth/callback`;
}

function b64urlToBytes(data){
  const s=String(data||"").replace(/-/g,"+").replace(/_/g,"/");
  const pad=s.length%4?"=".repeat(4-(s.length%4)):"";
  const bin=atob(s+pad);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

function b64urlToText(data){
  try{return new TextDecoder().decode(b64urlToBytes(data))}catch(e){return ""}
}

function normalizeFilename(v){
  return String(v||"file")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[\\/:*?"<>|]+/g,"_")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase() || "file";
}

function guessDocumentType(filename,mime,textProbe){
  const f=String(filename||"").toUpperCase();
  const p=String(textProbe||"").toUpperCase();
  if(/ALL\s+(CUSTOMERS|PAX)|LIST\s+OF\s*:\s*ALL\s+(CUSTOMERS|PAX)/.test(p))return "ALL_CUSTOMERS";
  if(/FQTV/.test(p)||/FQTV/.test(f))return "FQTV";
  if(/ETKT|TICKET/.test(p)||/ETKT|TICKET/.test(f))return "ETKT";
  if(/\bEMD\b/.test(p)||/\bEMD\b/.test(f))return "EMD";
  if(/WCHR|WCHS|WCHC|\bWCH\b/.test(p)||/WCHR|WCHS|WCHC|\bWCH\b/.test(f))return "WCH";
  if(/INFANT|\bINF\b/.test(p)||/INFANT|\bINF\b/.test(f))return "INF";
  if(/CHILD|CHLD|\bKID\b/.test(p)||/CHILD|CHLD|\bKID\b/.test(f))return "CHLD";
  if(/MEAL|[A-Z]{2}ML/.test(p)||/MEAL|[A-Z]{2}ML/.test(f))return "MEAL";
  if(/STAFF|REBATE|BOOKABLE/.test(p)||/STAFF|REBATE|BOOKABLE/.test(f))return "STAFF";
  if(/INAD/.test(p)||/INAD/.test(f))return "INAD";
  if(/DEPA/.test(p)||/DEPA/.test(f))return "DEPA";
  if(/DEPU/.test(p)||/DEPU/.test(f))return "DEPU";
  if(/UMNR|\bUM\b/.test(p)||/UMNR|\bUM\b/.test(f))return "UMNR";
  if(/MAAS/.test(p)||/MAAS/.test(f))return "MAAS";
  if(/INBOUND|CONNECTION FROM/.test(p)||/INBOUND/.test(f))return "INBOUND";
  if(/OUTBOUND|ONCARRIAGE|CONNECTION TO/.test(p)||/OUTBOUND/.test(f))return "OUTBOUND";
  if(/\.PDF$/i.test(filename))return "PDF";
  if(/\.TXT$/i.test(filename))return "TXT";
  if(/\.CSV$/i.test(filename))return "CSV";
  if(/\.XLSX?$/i.test(filename))return "EXCEL";
  if(/\.EML$/i.test(filename))return "EML";
  if(/\.ZIP$/i.test(filename))return "ZIP";
  return String(mime||"").split("/").pop()?.toUpperCase() || "OTHER";
}

function detectMailFlight(subject,filename,body){
  const source=`${subject||""} ${filename||""} ${body||""}`.toUpperCase();
  const out={airline:"",flightNumber:"",flightDate:""};
  const fm=source.match(/\b([A-Z0-9]{2})\s*[- ]?\s*(\d{2,4}[A-Z]?)\b/);
  if(fm){
    out.airline=fm[1];
    out.flightNumber=`${fm[1]}${fm[2]}`.replace(/\s+/g,"");
  }
  const dm=source.match(/\b(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b|\b(20\d{2}[-_/]\d{2}[-_/]\d{2})\b/);
  if(dm)out.flightDate=String(dm[1]||dm[2]||"").replace(/[\/]/g,"-");
  return out;
}

async function sha256Hex(bytes){
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function getGmailAccessToken(env){
  const cfg=await getIntegrationJson(env,"gmail_oauth");
  const refreshToken=String(cfg?.refresh_token||"").trim();
  const clientId=String(env.GOOGLE_CLIENT_ID||"").trim();
  const clientSecret=String(env.GOOGLE_CLIENT_SECRET||"").trim();
  if(!refreshToken||!clientId||!clientSecret)throw new Error("GMAIL API NON CONFIGURÉE");
  const form=new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"});
  const resp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form.toString()});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||!data?.access_token)throw new Error(data?.error_description||data?.error||`GMAIL TOKEN HTTP ${resp.status}`);
  return String(data.access_token);
}

async function gmailFetch(env,path,opts={}){
  const token=await getGmailAccessToken(env);
  const resp=await fetch(`${GMAIL_API_BASE}${path}`,{
    ...opts,
    headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json",...(opts.headers||{})}
  });
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(data?.error?.message||data?.error_description||`GMAIL HTTP ${resp.status}`);
  return data;
}

async function gmailStatus(env){
  await ensureGmailPipelineTables(env);
  const cfg=await getIntegrationJson(env,"gmail_oauth");
  const row=await env.OPS_DB.prepare(`SELECT * FROM gmail_sync_state WHERE mailbox='me' LIMIT 1`).first();
  const counters=await env.OPS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM gmail_messages) AS messages,
      (SELECT COUNT(*) FROM import_files) AS files,
      (SELECT COUNT(*) FROM import_file_versions) AS versions,
      (SELECT COUNT(*) FROM import_jobs WHERE status='QUEUED') AS queued_jobs,
      (SELECT COUNT(*) FROM import_jobs WHERE status='ERROR') AS error_jobs
  `).first();
  return {ok:true,connected:!!String(cfg?.refresh_token||"").trim(),connectedEmail:String(cfg?.email||""),connectedAt:String(cfg?.connected_at||""),syncState:row||null,counters:counters||{}};
}

async function ensureGmailLabel(env,name){
  const labels=await gmailFetch(env,"/labels");
  const found=(labels.labels||[]).find(l=>String(l.name||"")===name);
  if(found)return found.id;
  const created=await gmailFetch(env,"/labels",{method:"POST",body:JSON.stringify({name,labelListVisibility:"labelShow",messageListVisibility:"show"})});
  return created.id;
}

async function applyGmailLabel(env,messageId,labelName){
  if(!messageId||!labelName)return;
  const labelId=await ensureGmailLabel(env,labelName);
  await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}/modify`,{method:"POST",body:JSON.stringify({addLabelIds:[labelId]})});
}

function extractHeader(message,name){
  const h=message?.payload?.headers||[];
  const row=h.find(x=>String(x.name||"").toLowerCase()===String(name||"").toLowerCase());
  return String(row?.value||"");
}

function walkParts(part,out=[]){
  if(!part)return out;
  if(part.filename&&part.body?.attachmentId)out.push(part);
  for(const p of part.parts||[])walkParts(p,out);
  return out;
}

function extractPlainBody(message){
  let best="";
  function walk(p){
    if(!p)return;
    if(String(p.mimeType||"").toLowerCase()==="text/plain" && p.body?.data && !best)best=b64urlToText(p.body.data);
    for(const c of p.parts||[])walk(c);
  }
  walk(message.payload);
  return best;
}

async function recordImportChange(env,row){
  await env.OPS_DB.prepare(`
    INSERT INTO import_changes
      (scope,airline,flight_number,flight_date,gmail_message_id,file_id,version_id,change_type,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(row.scope||"FILE",row.airline||"",row.flightNumber||"",row.flightDate||"",row.gmailMessageId||"",row.fileId||"",row.versionId||"",row.changeType||"",JSON.stringify(row.before||null),JSON.stringify(row.after||null)).run();
}

async function storeGmailMessage(env,messageId){
  await ensureGmailPipelineTables(env);

  const existing=await env.OPS_DB.prepare(`SELECT gmail_message_id,status FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  if(existing){
    return {status:"DUPLICATE_MESSAGE",messageId,attachments:0};
  }

  const message=await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}?format=full`);
  const subject=extractHeader(message,"Subject");
  const sender=extractHeader(message,"From");
  const receivedAt=extractHeader(message,"Date");
  const bodyText=extractPlainBody(message);
  const flightBase=detectMailFlight(subject,"",bodyText);

  await env.OPS_DB.prepare(`
    INSERT INTO gmail_messages
      (gmail_message_id,gmail_thread_id,history_id,internal_date,subject,sender,received_at,snippet,label_state,airline,flight_number,flight_date,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(message.id||messageId,message.threadId||"",message.historyId||"",message.internalDate||"",subject,sender,receivedAt,message.snippet||"","RECEIVED",flightBase.airline,flightBase.flightNumber,flightBase.flightDate,"RECEIVED").run();

  await applyGmailLabel(env,messageId,GMAIL_LABELS.RECEIVED).catch(()=>{});

  const parts=walkParts(message.payload,[]);
  let added=0,updated=0,duplicate=0,error=0;

  for(const part of parts){
    try{
      const attachmentId=String(part.body?.attachmentId||"");
      const filename=String(part.filename||"attachment");
      const norm=normalizeFilename(filename);
      const mime=String(part.mimeType||"application/octet-stream");
      const att=await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      const bytes=b64urlToBytes(att.data||"");
      const sha=await sha256Hex(bytes);
      const flight=detectMailFlight(subject,filename,bodyText);
      if(!flight.airline)Object.assign(flight,flightBase);
      const docType=guessDocumentType(filename,mime,bodyText.slice(0,5000));
      const airline=flight.airline||"UNK";
      const flightNumber=flight.flightNumber||"UNIDENTIFIED";
      const flightDate=flight.flightDate||"UNKNOWN_DATE";
      const fileId=`${airline}|${flightNumber}|${flightDate}|${docType}|${norm}`;
      const versionId=`${fileId}|${sha}`;
      const r2Key=`prepa/${flightDate}/${airline}/${flightNumber}/${messageId}/${sha}_${norm}`.replace(/\s+/g,"_");

      const existingVersion=await env.OPS_DB.prepare(`SELECT version_id FROM import_file_versions WHERE version_id=? LIMIT 1`).bind(versionId).first();
      if(existingVersion){
        duplicate++;
        await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"DUPLICATE",after:{filename,sha}});
        continue;
      }

      await env.OPS_FILES.put(r2Key,bytes,{httpMetadata:{contentType:mime},customMetadata:{gmail_message_id:messageId,filename_original:filename,sha256:sha,document_type:docType}});

      const existingFile=await env.OPS_DB.prepare(`SELECT file_id,active_version_id,latest_document_time FROM import_files WHERE file_id=? LIMIT 1`).bind(fileId).first();

      await env.OPS_DB.prepare(`
        INSERT INTO import_file_versions
          (version_id,file_id,gmail_message_id,attachment_id,filename_original,filename_normalized,mime_type,file_size,sha256,r2_key,document_time,received_at,status,is_active,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'STORED', 1, CURRENT_TIMESTAMP)
      `).bind(versionId,fileId,messageId,attachmentId,filename,norm,mime,bytes.byteLength,sha,r2Key,receivedAt,receivedAt).run();

      if(existingFile){
        await env.OPS_DB.prepare(`UPDATE import_file_versions SET is_active=0 WHERE file_id=? AND version_id<>?`).bind(fileId,versionId).run();
        await env.OPS_DB.prepare(`
          UPDATE import_files SET active_version_id=?,status='UPDATED',latest_document_time=?,updated_at=CURRENT_TIMESTAMP
          WHERE file_id=?
        `).bind(versionId,receivedAt,fileId).run();
        updated++;
        await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"UPDATED",before:{activeVersionId:existingFile.active_version_id},after:{filename,sha,r2Key}});
      }else{
        await env.OPS_DB.prepare(`
          INSERT INTO import_files
            (file_id,active_version_id,airline,flight_number,flight_date,document_type,filename_normalized,status,latest_document_time,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        `).bind(fileId,versionId,airline,flightNumber,flightDate,docType,norm,"ADDED",receivedAt).run();
        added++;
        await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"ADDED",after:{filename,sha,r2Key}});
      }

      const priority=docType==="ALL_CUSTOMERS"?10:docType==="PDF"?50:70;
      await env.OPS_DB.prepare(`
        INSERT INTO import_jobs
          (job_id,job_type,priority,airline,flight_number,flight_date,file_id,version_id,gmail_message_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'QUEUED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO NOTHING
      `).bind(`PARSE|${versionId}`,"PARSE_FILE",priority,airline,flightNumber,flightDate,fileId,versionId,messageId).run();
    }catch(e){
      error++;
      await recordImportChange(env,{scope:"MESSAGE",gmailMessageId:messageId,changeType:"ERROR",after:{error:String(e?.message||e)}}).catch(()=>{});
    }
  }

  const finalStatus=error?"ERROR":updated?"UPDATED":added?"IMPORTED":duplicate?"DUPLICATE":"NO_ATTACHMENT";
  await env.OPS_DB.prepare(`UPDATE gmail_messages SET status=?,label_state=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(finalStatus,finalStatus,messageId).run();

  const label=finalStatus==="ERROR"?GMAIL_LABELS.ERROR:finalStatus==="UPDATED"?GMAIL_LABELS.UPDATED:finalStatus==="DUPLICATE"?GMAIL_LABELS.DUPLICATE:GMAIL_LABELS.IMPORTED;
  await applyGmailLabel(env,messageId,label).catch(()=>{});

  return {status:finalStatus,messageId,attachments:parts.length,added,updated,duplicate,error};
}

async function gmailSyncNow(env,body){
  await ensureGmailPipelineTables(env);
  const query=String(body?.query||"has:attachment").trim();
  const maxMessages=Math.max(1,Math.min(100,Number(body?.maxMessages||25)));
  const pageToken=String(body?.pageToken||"").trim();
  const params=new URLSearchParams({q:query,maxResults:String(maxMessages)});
  if(pageToken)params.set("pageToken",pageToken);
  const list=await gmailFetch(env,`/messages?${params.toString()}`);
  const messages=list.messages||[];
  const results=[];
  for(const m of messages){
    results.push(await storeGmailMessage(env,m.id));
  }
  await env.OPS_DB.prepare(`
    INSERT INTO gmail_sync_state (mailbox,last_full_sync_at,backfill_query,backfill_page_token,backfill_status,updated_at)
    VALUES ('me',CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(mailbox) DO UPDATE SET
      last_full_sync_at=CURRENT_TIMESTAMP,
      backfill_query=excluded.backfill_query,
      backfill_page_token=excluded.backfill_page_token,
      backfill_status=excluded.backfill_status,
      updated_at=CURRENT_TIMESTAMP
  `).bind(query,String(list.nextPageToken||""),list.nextPageToken?"RUNNING":"DONE").run();
  return {ok:true,query,maxMessages,processed:results.length,nextPageToken:list.nextPageToken||"",results};
}

async function gmailOAuthStart(request,env){
  const clientId=String(env.GOOGLE_CLIENT_ID||"").trim();
  if(!clientId)return json({ok:false,error:"GOOGLE_CLIENT_ID MANQUANT"},400);
  const state=crypto.randomUUID();
  await setIntegrationJson(env,"gmail_oauth_state",{state,created_at:new Date().toISOString()});
  const params=new URLSearchParams({
    client_id:clientId,
    redirect_uri:gmailRedirectUri(request),
    response_type:"code",
    access_type:"offline",
    prompt:"consent",
    include_granted_scopes:"true",
    scope:["https://www.googleapis.com/auth/gmail.modify","https://www.googleapis.com/auth/userinfo.email"].join(" "),
    state
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,302);
}

async function gmailOAuthCallback(request,env,url){
  try{
    const code=url.searchParams.get("code")||"";
    const state=url.searchParams.get("state")||"";
    const saved=await getIntegrationJson(env,"gmail_oauth_state");
    if(!code)throw new Error(url.searchParams.get("error")||"CODE OAUTH MANQUANT");
    if(!saved?.state||state!==saved.state)throw new Error("STATE OAUTH INVALIDE");

    const form=new URLSearchParams({
      client_id:String(env.GOOGLE_CLIENT_ID||""),
      client_secret:String(env.GOOGLE_CLIENT_SECRET||""),
      code,
      grant_type:"authorization_code",
      redirect_uri:gmailRedirectUri(request)
    });
    const tokenResp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form.toString()});
    const token=await tokenResp.json().catch(()=>({}));
    if(!tokenResp.ok||!token.refresh_token)throw new Error(token.error_description||token.error||"REFRESH TOKEN GMAIL ABSENT");

    const infoResp=await fetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:`Bearer ${token.access_token}`}});
    const info=await infoResp.json().catch(()=>({}));
    await setIntegrationJson(env,"gmail_oauth",{refresh_token:token.refresh_token,email:String(info.email||""),connected_at:new Date().toISOString(),scope:token.scope||""});
    await ensureGmailPipelineTables(env);
    return googleCallbackHtml(true,`Gmail API connectée : ${String(info.email||"compte Google")}`);
  }catch(e){
    return googleCallbackHtml(false,String(e?.message||e));
  }
}

async function importPipelineStatus(env){
  await ensureGmailPipelineTables(env);
  const rows=await env.OPS_DB.prepare(`
    SELECT status, COUNT(*) AS count
    FROM import_jobs
    GROUP BY status
  `).all();
  const files=await env.OPS_DB.prepare(`
    SELECT status, COUNT(*) AS count
    FROM import_files
    GROUP BY status
  `).all();
  const recent=await env.OPS_DB.prepare(`
    SELECT created_at,change_type,airline,flight_number,flight_date,file_id,version_id
    FROM import_changes
    ORDER BY id DESC
    LIMIT 50
  `).all();
  return {ok:true,jobs:rows.results||[],files:files.results||[],recentChanges:recent.results||[]};
}



/* =========================================================
 * ALYZIA OPS V50.7 — LOT 2 IMPORT JOB PROCESSOR
 * ---------------------------------------------------------
 * Objectif du lot 2 :
 * - prendre les jobs QUEUED créés par le Lot 1
 * - lire les fichiers dans R2
 * - extraire un texte opérationnel quand possible
 * - classifier le document
 * - préparer le résultat pour le Lot 3, sans injection fiche vol
 *
 * VERROUILLAGE :
 * - SQ / TK / BJ / TW : parsers spécifiques NON TOUCHÉS.
 *   Le job est marqué READY_SPECIFIC_PARSER.
 * - Autres compagnies : GENERIC.
 *   ALL CUSTOMERS / ALL PAX = MASTER.
 *   LIST OF: XXXXX = carte correspondante.
 * ========================================================= */

const LOT2_SPECIFIC_AIRLINES = new Set(["SQ","TK","BJ","TW"]);

async function ensureImportProcessorTables(env){
  await ensureGmailPipelineTables(env);
  await env.OPS_DB.batch([
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS import_job_results (
        job_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        airline TEXT,
        flight_number TEXT,
        flight_date TEXT,
        parser_mode TEXT,
        document_type TEXT,
        list_name TEXT,
        card_key TEXT,
        passenger_count INTEGER,
        class_counts_json TEXT,
        extracted_text_preview TEXT,
        result_json TEXT,
        status TEXT NOT NULL DEFAULT 'CLASSIFIED',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_import_job_results_flight ON import_job_results(airline,flight_number,flight_date,updated_at)`),
    env.OPS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_import_job_results_version ON import_job_results(version_id)`)
  ]);
}

function lot2Upper(v){return String(v||"").toUpperCase().replace(/\u00a0/g," ");}
function lot2CleanText(v){
  return String(v||"")
    .replace(/\u0000/g," ")
    .replace(/[\t ]+/g," ")
    .replace(/\r/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function lot2FileExtension(filename){
  const m=String(filename||"").toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m?m[1]:"";
}

function lot2DecodeUtf8(bytes){
  try{return new TextDecoder("utf-8",{fatal:false}).decode(bytes)}catch(e){return ""}
}

function lot2DecodeLatin1(bytes){
  let out="";
  const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk){
    out+=String.fromCharCode(...bytes.slice(i,i+chunk));
  }
  return out;
}

function lot2ExtractPdfStrings(raw){
  const source=String(raw||"");
  const out=[];

  // Texte PDF fréquent : chaînes littérales entre parenthèses.
  for(const m of source.matchAll(/\((?:\\.|[^\\()]){2,}\)/g)){
    let v=m[0].slice(1,-1)
      .replace(/\\n/g,"\n")
      .replace(/\\r/g,"\n")
      .replace(/\\t/g," ")
      .replace(/\\([()\\])/g,"$1")
      .replace(/\\\d{1,3}/g," ");
    if(/[A-Za-z0-9]{2}/.test(v))out.push(v);
  }

  // Texte hexadécimal PDF simple : <0041004C...> ou <414C...>
  for(const m of source.matchAll(/<([0-9A-Fa-f]{8,})>/g)){
    const hex=m[1];
    if(hex.length>3000)continue;
    try{
      const bytes=[];
      for(let i=0;i<hex.length;i+=2)bytes.push(parseInt(hex.slice(i,i+2),16));
      let ascii=String.fromCharCode(...bytes).replace(/\u0000/g,"");
      if(/[A-Za-z]{3}/.test(ascii))out.push(ascii);
    }catch(e){}
  }

  // Fallback : blocs ASCII visibles dans le PDF.
  for(const m of source.matchAll(/[A-Za-z0-9][A-Za-z0-9 .,:;_\-/()#'&]{8,}/g)){
    const v=m[0];
    if(!/^(obj|endobj|stream|endstream|xref|trailer)$/i.test(v))out.push(v);
  }

  return lot2CleanText(out.join("\n"));
}

async function lot2ExtractTextFromR2Object(object,filename,mime){
  const ext=lot2FileExtension(filename);
  const size=Number(object?.size||0);
  const MAX_PARSE_BYTES=25*1024*1024;
  if(size>MAX_PARSE_BYTES){
    return {text:"",readable:false,reason:`FICHIER TROP VOLUMINEUX POUR PARSING WORKER (${size} bytes)`};
  }

  const bytes=new Uint8Array(await object.arrayBuffer());
  const m=String(mime||"").toLowerCase();

  if(ext==="zip")return {text:"",readable:false,reason:"ZIP STOCKÉ · PARSING DIFFÉRÉ"};
  if(["xls","xlsx","doc","docx","msg"].includes(ext)){
    // Ces fichiers sont stockés et indexés au Lot 1. Le parsing natif arrivera par module dédié.
    return {text:lot2CleanText(lot2DecodeUtf8(bytes).slice(0,200000)),readable:false,reason:`${ext.toUpperCase()} STOCKÉ · PARSING DÉDIÉ À AJOUTER`};
  }
  if(ext==="pdf" || m.includes("pdf")){
    const raw=lot2DecodeLatin1(bytes);
    const text=lot2ExtractPdfStrings(raw);
    return {text,readable:!!text,reason:text?"PDF_TEXT_EXTRACTED":"PDF SANS TEXTE EXPLOITABLE PAR LE WORKER"};
  }

  if(m.startsWith("text/") || ["txt","csv","html","htm","eml","json","xml"].includes(ext)){
    return {text:lot2CleanText(lot2DecodeUtf8(bytes)),readable:true,reason:"TEXT_EXTRACTED"};
  }

  return {text:lot2CleanText(lot2DecodeUtf8(bytes).slice(0,200000)),readable:false,reason:"TYPE STOCKÉ · PARSING NON PRIORITAIRE"};
}

function lot2DetectListName(text,filename){
  /*
   * V50.9 — STRICT EXPLICIT PDF LIST NAME
   * On ne déduit jamais le nom de liste depuis des mots passagers.
   *
   * Sources autorisées :
   *   1) une ligne explicite "LIST OF: XXXXX"
   *   2) un titre explicite de rapport résumé Altea :
   *      "INBOUND CUSTOMER SUMMARY" ou "ONCARRIAGE CUSTOMER SUMMARY"
   *
   * Si aucune source explicite n'est trouvée, on retourne "".
   */
  const raw=lot2CleanText(String(text||"")).replace(/\r/g,"\n");
  const lines=raw.split(/\n+/).map(x=>String(x||"").trim()).filter(Boolean);

  function cleanListName(v){
    return String(v||"")
      .replace(/\b(?:TOTAL|TTL)\b.*$/i,"")
      .replace(/\b[FJCWSY]\s*\d+\b/gi,"")
      .replace(/\s+/g," ")
      .trim();
  }

  for(const line of lines.slice(0,160)){
    const m=line.match(/\bLIST\s+OF\s*:\s*(.{2,140})$/i);
    if(!m)continue;
    const cleaned=cleanListName(m[1]);
    if(cleaned)return cleaned;
  }

  // OCR/text extraction peut parfois coller "LIST OF:" au milieu d'une ligne.
  const compact=raw.slice(0,12000);
  const m=compact.match(/\bLIST\s+OF\s*:\s*([^\n\r]{2,140})/i);
  if(m){
    const cleaned=cleanListName(m[1]);
    if(cleaned)return cleaned;
  }

  // Titres explicites de rapports sommaires, sans inventer de liste.
  for(const line of lines.slice(0,80)){
    if(/^INBOUND\s+CUSTOMER\s+SUMMARY\b/i.test(line))return "INBOUND CUSTOMER SUMMARY";
    if(/^ONCARRIAGE\s+CUSTOMER\s+SUMMARY\b/i.test(line))return "ONCARRIAGE CUSTOMER SUMMARY";
  }

  return "";
}

const LOT2_GENERIC_DEFAULT_LIST_MAPPINGS = [
  ["ALL CUSTOMERS","MASTER"],
  ["ALL PAX","MASTER"],
  ["ALL RESERVATION","MASTER"],
  ["FQTV","FQTV"],
  ["WCH","WCH"],
  ["WCHR","WCH"],
  ["WCHS","WCH"],
  ["WCHC","WCH"],
  ["WCMP","WCH"],
  ["WCBD","WCH"],
  ["WCLB","WCH"],
  ["INF","INF"],
  ["INFANT","INF"],
  ["CHLD","CHLD"],
  ["CHILD","CHLD"],
  ["KID","CHLD"],
  ["ETKT","ETKT"],
  ["TICKET","ETKT"],
  ["EMD","EMD"],
  ["MEAL","MEAL"],
  ["SPML","MEAL"],
  ["VGML","MEAL"],
  ["AVML","MEAL"],
  ["BBML","MEAL"],
  ["CHML","MEAL"],
  ["HNML","MEAL"],
  ["KSML","MEAL"],
  ["MOML","MEAL"],
  ["INAD","INAD"],
  ["DEPA","DEPA"],
  ["DEPU","DEPU"],
  ["UMNR","UMNR"],
  ["UM","UMNR"],
  ["MAAS","MAAS"],
  ["INBOUND CUSTOMER SUMMARY","INBOUND"],
  ["ONCARRIAGE CUSTOMER SUMMARY","OUTBOUND"]
];

const LOT2_GENERIC_AIRLINE_LIST_MAPPINGS = {
  J2: [
    ["FQA","FQTV"],
    ["ONC","OUTBOUND"],
    ["INC","INBOUND"],
    ["WCH","WCH"],
    ["INBOUND CUSTOMER SUMMARY","INBOUND"],
    ["ONCARRIAGE CUSTOMER SUMMARY","OUTBOUND"]
  ]
};

function lot2NormalizeListKey(v){
  return lot2Upper(v)
    .replace(/[^A-Z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function lot2LookupListMapping(airline,listName){
  const raw=lot2NormalizeListKey(listName);
  if(!raw)return {cardKey:"NO_LIST", mappingScope:"NONE", matchedListName:""};

  const airlineKey=lot2Upper(airline);
  const airlineRows=LOT2_GENERIC_AIRLINE_LIST_MAPPINGS[airlineKey]||[];

  for(const [name,cardKey] of airlineRows){
    if(raw===lot2NormalizeListKey(name)){
      return {cardKey, mappingScope:airlineKey, matchedListName:name};
    }
  }

  for(const [name,cardKey] of LOT2_GENERIC_DEFAULT_LIST_MAPPINGS){
    if(raw===lot2NormalizeListKey(name)){
      return {cardKey, mappingScope:"DEFAULT", matchedListName:name};
    }
  }

  // Groupes de codes repas : si le nom explicite LIST OF est un code meal connu.
  if(/^[A-Z]{2}ML$/.test(raw)){
    return {cardKey:"MEAL", mappingScope:"DEFAULT_PATTERN", matchedListName:"MEAL_CODE"};
  }

  return {cardKey:"OTHER", mappingScope:"UNMAPPED", matchedListName:""};
}

function lot2GenericCardFromListName(listName,airline){
  return lot2LookupListMapping(airline,listName).cardKey;
}

function lot2ExtractClassCounts(text){
  const up=lot2Upper(text);
  const out={};
  const sample=up.slice(0,8000);
  for(const m of sample.matchAll(/\b([FJCWSY])\s*(\d{1,4})\b/g)){
    const k=m[1];
    const n=Number(m[2]||0);
    if(Number.isFinite(n))out[k]=Math.max(Number(out[k]||0),n);
  }
  return out;
}

function lot2ExtractPassengerCount(text,listName){
  const up=lot2Upper(text);
  const header=up.match(/\bLIST\s+OF\s*:\s*[^\n\r]{0,200}/);
  const h=header?header[0]:up.slice(0,2000);
  let m=h.match(/\bTOTAL\s*(\d{1,5})\b/);
  if(m)return Number(m[1]);
  m=h.match(/\bTTL\s*(\d{1,5})\b/);
  if(m)return Number(m[1]);
  const classCounts=lot2ExtractClassCounts(h);
  const sum=Object.values(classCounts).reduce((a,b)=>a+Number(b||0),0);
  if(sum>0)return sum;

  // Fallback nominatif Altea : lignes commençant par numéro + NOM/PRENOM.
  const names=new Set();
  for(const line of up.split(/\n+/)){
    const r=line.trim();
    const nm=r.match(/^\s*\d{1,4}[.)]?\s*([A-Z][A-Z' .-]{1,60}\/[A-Z][A-Z' .-]{1,80})/);
    if(nm)names.add(nm[1].replace(/\s+/g," "));
  }
  if(names.size)return names.size;
  return 0;
}

function lot2Preview(text){
  return lot2CleanText(text).slice(0,2500);
}

function lot2DocumentTypeFromCard(cardKey,filename,mime){
  if(cardKey==="MASTER")return "ALL_CUSTOMERS";
  if(cardKey && cardKey!=="OTHER")return cardKey;
  return guessDocumentType(filename,mime,"");
}

async function lot2ProcessOneJob(env,job){
  const jobId=String(job.job_id||"");
  await env.OPS_DB.prepare(`UPDATE import_jobs SET status='PROCESSING',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(jobId).run();

  try{
    const version=await env.OPS_DB.prepare(`
      SELECT * FROM import_file_versions WHERE version_id=? LIMIT 1
    `).bind(job.version_id).first();
    if(!version)throw new Error("VERSION INTROUVABLE");
    if(!env.OPS_FILES)throw new Error("BINDING R2 OPS_FILES ABSENT");

    const object=await env.OPS_FILES.get(version.r2_key);
    if(!object)throw new Error("FICHIER R2 INTROUVABLE");

    const filename=version.filename_original||version.filename_normalized||"file";
    const mime=version.mime_type||object.httpMetadata?.contentType||"application/octet-stream";
    const extracted=await lot2ExtractTextFromR2Object(object,filename,mime);
    const airline=String(job.airline||version.airline||"").toUpperCase();
    const parserMode=LOT2_SPECIFIC_AIRLINES.has(airline)?"SPECIFIC_LOCKED":"GENERIC";

    const listName=lot2DetectListName(extracted.text,filename);
    const listMapping=parserMode==="SPECIFIC_LOCKED"
      ? {cardKey:"SPECIFIC",mappingScope:"SPECIFIC_LOCKED",matchedListName:""}
      : lot2LookupListMapping(airline,listName);
    const cardKey=listMapping.cardKey;
    const documentType=lot2DocumentTypeFromCard(cardKey,filename,mime);
    const passengerCount=lot2ExtractPassengerCount(extracted.text,listName);
    const classCounts=lot2ExtractClassCounts(extracted.text);

    let resultStatus="CLASSIFIED";
    let changeType="DOC_CLASSIFIED";

    if(parserMode==="SPECIFIC_LOCKED"){
      resultStatus="READY_SPECIFIC_PARSER";
      changeType="SPECIFIC_READY";
    }else if(cardKey==="NO_LIST"){
      resultStatus=extracted.readable?"GENERIC_LIST_NOT_FOUND":"ARCHIVED_ONLY";
      changeType=extracted.readable?"GENERIC_LIST_NOT_FOUND":"ARCHIVED_ONLY";
    }else if(cardKey==="MASTER"){
      resultStatus="GENERIC_MASTER_READY";
      changeType="GENERIC_MASTER_READY";
    }else if(cardKey==="OTHER"){
      // OTHER est autorisé uniquement si un vrai "LIST OF: XXXXX" existe
      // mais que XXXXX n'est pas encore mappé.
      resultStatus=extracted.readable?"GENERIC_CARD_OTHER":"ARCHIVED_ONLY";
      changeType=extracted.readable?"GENERIC_CARD_OTHER":"ARCHIVED_ONLY";
    }else{
      resultStatus="GENERIC_CARD_READY";
      changeType="GENERIC_CARD_READY";
    }

    const result={
      lot:"LOT2",
      parserMode,
      documentType,
      listName,
      cardKey,
      passengerCount,
      classCounts,
      readable:extracted.readable,
      reason:extracted.reason,
      rules: parserMode==="SPECIFIC_LOCKED"
        ? "Parser spécifique verrouillé : aucune transformation Worker Lot 2."
        : "GENERIC V50.10 : listName = nom exact du fichier ; cardKey = mapping par compagnie puis DEFAULT ; aucune carte inventée.",
      mappingScope:listMapping.mappingScope,
      matchedListName:listMapping.matchedListName
    };

    await env.OPS_DB.prepare(`
      INSERT INTO import_job_results
        (job_id,version_id,file_id,airline,flight_number,flight_date,parser_mode,document_type,list_name,card_key,passenger_count,class_counts_json,extracted_text_preview,result_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id) DO UPDATE SET
        version_id=excluded.version_id,
        file_id=excluded.file_id,
        airline=excluded.airline,
        flight_number=excluded.flight_number,
        flight_date=excluded.flight_date,
        parser_mode=excluded.parser_mode,
        document_type=excluded.document_type,
        list_name=excluded.list_name,
        card_key=excluded.card_key,
        passenger_count=excluded.passenger_count,
        class_counts_json=excluded.class_counts_json,
        extracted_text_preview=excluded.extracted_text_preview,
        result_json=excluded.result_json,
        status=excluded.status,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      jobId,version.version_id,version.file_id,job.airline||"",job.flight_number||"",job.flight_date||"",
      parserMode,documentType,listName,cardKey,passengerCount,JSON.stringify(classCounts),lot2Preview(extracted.text),JSON.stringify(result),resultStatus
    ).run();

    await env.OPS_DB.prepare(`UPDATE import_file_versions SET status=? WHERE version_id=?`).bind(resultStatus,version.version_id).run();
    await env.OPS_DB.prepare(`UPDATE import_files SET status=?, document_type=?, updated_at=CURRENT_TIMESTAMP WHERE file_id=?`).bind(resultStatus,documentType,version.file_id).run();
    await env.OPS_DB.prepare(`UPDATE import_jobs SET status='DONE', error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(jobId).run();

    await recordImportChange(env,{
      scope:"JOB",
      airline:job.airline,
      flightNumber:job.flight_number,
      flightDate:job.flight_date,
      gmailMessageId:job.gmail_message_id,
      fileId:version.file_id,
      versionId:version.version_id,
      changeType,
      after:result
    });

    return {ok:true,jobId,status:resultStatus,airline:job.airline,flightNumber:job.flight_number,flightDate:job.flight_date,documentType,listName,cardKey,passengerCount,mappingScope:listMapping.mappingScope,matchedListName:listMapping.matchedListName};
  }catch(e){
    const msg=String(e?.message||e);
    await env.OPS_DB.prepare(`UPDATE import_jobs SET status='ERROR',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(msg,jobId).run();
    await recordImportChange(env,{scope:"JOB",airline:job.airline,flightNumber:job.flight_number,flightDate:job.flight_date,gmailMessageId:job.gmail_message_id,fileId:job.file_id,versionId:job.version_id,changeType:"JOB_ERROR",after:{error:msg}}).catch(()=>{});
    return {ok:false,jobId,error:msg};
  }
}

async function lot2ProcessNext(env,body){
  await ensureImportProcessorTables(env);
  const limit=Math.max(1,Math.min(50,Number(body?.limit||10)));
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT *
    FROM import_jobs
    WHERE status='QUEUED'
      AND (run_after IS NULL OR run_after='' OR run_after<=CURRENT_TIMESTAMP)
    ORDER BY priority ASC, created_at ASC
    LIMIT ?
  `).bind(limit).all();

  const processed=[];
  for(const job of results){
    processed.push(await lot2ProcessOneJob(env,job));
  }
  return {ok:true,requested:limit,found:results.length,processed};
}

async function lot2Requeue(env,body){
  await ensureImportProcessorTables(env);
  const status=String(body?.status||"ERROR").toUpperCase();
  const allowed=new Set(["ERROR","DONE","PROCESSING"]);
  if(!allowed.has(status))return {ok:false,error:"STATUT NON AUTORISÉ"};
  const r=await env.OPS_DB.prepare(`UPDATE import_jobs SET status='QUEUED',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE status=?`).bind(status).run();
  return {ok:true,requeued:r.meta?.changes||0,fromStatus:status};
}

async function lot2Results(env,url){
  await ensureImportProcessorTables(env);
  const airline=String(url.searchParams.get("airline")||"").toUpperCase();
  const flight=String(url.searchParams.get("flight")||"").toUpperCase();
  const date=String(url.searchParams.get("date")||"");
  const limit=Math.max(1,Math.min(200,Number(url.searchParams.get("limit")||50)));
  const wh=[]; const binds=[];
  if(airline){wh.push("airline=?");binds.push(airline)}
  if(flight){wh.push("flight_number=?");binds.push(flight)}
  if(date){wh.push("flight_date=?");binds.push(date)}
  binds.push(limit);
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT job_id,version_id,file_id,airline,flight_number,flight_date,parser_mode,document_type,list_name,card_key,passenger_count,class_counts_json,status,updated_at,extracted_text_preview
    FROM import_job_results
    ${wh.length?`WHERE ${wh.join(" AND ")}`:""}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...binds).all();
  return {ok:true,count:results.length,results:results.map(r=>({...r,class_counts:safeJsonParse(r.class_counts_json,{})}))};
}

async function lot2PipelineSummary(env){
  await ensureImportProcessorTables(env);
  const jobs=await env.OPS_DB.prepare(`SELECT status,COUNT(*) AS count FROM import_jobs GROUP BY status`).all();
  const files=await env.OPS_DB.prepare(`SELECT status,COUNT(*) AS count FROM import_files GROUP BY status`).all();
  const results=await env.OPS_DB.prepare(`SELECT status,parser_mode,card_key,COUNT(*) AS count FROM import_job_results GROUP BY status,parser_mode,card_key ORDER BY status,parser_mode,card_key`).all();
  const recent=await env.OPS_DB.prepare(`
    SELECT created_at,change_type,airline,flight_number,flight_date,file_id,version_id,after_json
    FROM import_changes
    ORDER BY id DESC
    LIMIT 50
  `).all();
  return {ok:true,jobs:jobs.results||[],files:files.results||[],classified:results.results||[],recentChanges:recent.results||[]};
}

async function handleGmailPipeline(request,env,url){
  if(!url.pathname.startsWith("/api/gmail") && !url.pathname.startsWith("/api/import-pipeline"))return null;
  try{
    if(url.pathname==="/api/gmail/status" && request.method==="GET")return json(await gmailStatus(env));
    if(url.pathname==="/api/gmail/oauth/start" && request.method==="GET")return gmailOAuthStart(request,env);
    if(url.pathname==="/api/gmail/oauth/callback" && request.method==="GET")return gmailOAuthCallback(request,env,url);
    if(url.pathname==="/api/gmail/sync-now" && request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      return json(await gmailSyncNow(env,body));
    }
    if(url.pathname==="/api/import-pipeline/status" && request.method==="GET")return json(await lot2PipelineSummary(env));
    if(url.pathname==="/api/import-pipeline/results" && request.method==="GET")return json(await lot2Results(env,url));
    if(url.pathname==="/api/import-pipeline/process-next" && request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      return json(await lot2ProcessNext(env,body));
    }
    if(url.pathname==="/api/import-pipeline/requeue" && request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      return json(await lot2Requeue(env,body));
    }
    return json({ok:false,error:"ROUTE GMAIL PIPELINE INCONNUE"},404);
  }catch(e){
    return json({ok:false,error:String(e?.message||e)},500);
  }
}


async function handlePrepa(request, env, url) {

  if (!url.pathname.startsWith("/api/prepa")) {
    return null;
  }


  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }


  /*
   * GOOGLE APPS SCRIPT -> ALYZIA
   */
  if (
    url.pathname === "/api/prepa/import" &&
    request.method === "POST"
  ) {

    if (!isAuthorizedPrepa(request, env)) {

      return json({
        ok: false,
        error: "NON AUTORISE"
      }, 401);

    }


    const body =
      await request.json()
        .catch(() => null);


    const item =
      normalizePrepaPayload(body);


    if (!item) {

      return json({
        ok: false,
        error: "PREPA INVALIDE"
      }, 400);

    }


    const suppression=await isPrepaSuppressed(env,item);

    if(suppression.suppressed){
      return json({
        ok:true,
        accepted:false,
        neutralized:true,
        reason:suppression.reason,
        gmailMessageId:item.gmailMessageId,
        airline:item.airline,
        flightNumber:item.flightNumber,
        flightDate:item.flightDate,
        status:"SUPPRESSED"
      });
    }

    const savedStatus =
      await savePrepaInbox(
        env,
        item
      );


    return json({
      ok: true,

      accepted: true,

      gmailMessageId:
        item.gmailMessageId,

      airline:
        item.airline,

      flightNumber:
        item.flightNumber,

      flightDate:
        item.flightDate,

      status:
        savedStatus
    });
  }



  /*
   * V50.5 — statut connexion Google Drive directe.
   */
  if(
    url.pathname==="/api/prepa/google-drive/status" &&
    request.method==="GET"
  ){
    return json({ok:true,...await googleDriveStatus(env)});
  }

  /*
   * V50.5 — démarre l'autorisation Google Drive depuis ALYZIA OPS.
   * Pas d'Apps Script.
   */
  if(
    url.pathname==="/api/prepa/google-drive/oauth/start" &&
    request.method==="POST"
  ){
    await ensurePrepaControlTables(env);

    const clientId=String(env.GOOGLE_CLIENT_ID||"").trim();
    const clientSecret=String(env.GOOGLE_CLIENT_SECRET||"").trim();

    if(!clientId||!clientSecret){
      return json({
        ok:false,
        error:"GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET MANQUANTS DANS LE WORKER"
      },409);
    }

    const state=crypto.randomUUID();
    await setIntegrationJson(env,"google_drive_oauth_state",{
      state,
      created_at:Date.now()
    });

    const auth=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id",clientId);
    auth.searchParams.set("redirect_uri",googleDriveRedirectUri(request));
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("scope","https://www.googleapis.com/auth/drive");
    auth.searchParams.set("access_type","offline");
    auth.searchParams.set("prompt","consent");
    auth.searchParams.set("state",state);

    return json({ok:true,authorizationUrl:auth.toString()});
  }

  /*
   * Callback OAuth Google Drive.
   */
  if(
    url.pathname==="/api/prepa/google-drive/oauth/callback" &&
    request.method==="GET"
  ){
    const code=String(url.searchParams.get("code")||"").trim();
    const state=String(url.searchParams.get("state")||"").trim();
    const err=String(url.searchParams.get("error")||"").trim();

    if(err)return googleCallbackHtml(false,err);
    if(!code||!state)return googleCallbackHtml(false,"CODE / STATE MANQUANT");

    const savedState=await getIntegrationJson(env,"google_drive_oauth_state");
    if(
      !savedState ||
      String(savedState.state||"")!==state ||
      Date.now()-Number(savedState.created_at||0)>15*60*1000
    ){
      return googleCallbackHtml(false,"STATE OAUTH INVALIDE OU EXPIRÉ");
    }

    const form=new URLSearchParams({
      code,
      client_id:String(env.GOOGLE_CLIENT_ID||""),
      client_secret:String(env.GOOGLE_CLIENT_SECRET||""),
      redirect_uri:googleDriveRedirectUri(request),
      grant_type:"authorization_code"
    });

    const resp=await fetch("https://oauth2.googleapis.com/token",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:form.toString()
    });

    const token=await resp.json().catch(()=>({}));
    if(!resp.ok||!token?.refresh_token){
      return googleCallbackHtml(
        false,
        token?.error_description||token?.error||`TOKEN HTTP ${resp.status}`
      );
    }

    // Récupère l'adresse du compte si possible.
    let email="";
    try{
      const me=await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
        {headers:{Authorization:`Bearer ${token.access_token}`}}
      );
      const mj=await me.json();
      email=String(mj?.user?.emailAddress||"");
    }catch(e){}

    await setIntegrationJson(env,"google_drive_oauth",{
      refresh_token:String(token.refresh_token),
      email,
      connected_at:new Date().toISOString()
    });

    return googleCallbackHtml(
      true,
      email ? `Compte connecté : ${email}` : "Google Drive est prêt."
    );
  }

  /*
   * V50.5 — REPAIR par VOL / COMPAGNIE / TOUT.
   * Les vols neutralisés par suppression ne sont jamais remis à PENDING.
   */
  if(
    url.pathname==="/api/prepa/repair" &&
    request.method==="POST"
  ){
    const body=await request.json().catch(()=>null);
    try{
      const result=await repairPrepaScope(env,body||{});
      return json({ok:true,...result});
    }catch(e){
      return json({ok:false,error:String(e?.message||e)},400);
    }
  }


  /*
   * ALYZIA OPS -> résultat du traitement d'une PREPA
   * Autorise uniquement PENDING / PROCESSING / PROCESSED / ERROR.
   */
  if (
    url.pathname === "/api/prepa/status" &&
    request.method === "PATCH"
  ) {

    const body =
      await request.json()
        .catch(() => null);

    const id =
      Number(body?.id);

    const gmailMessageId =
      String(body?.gmailMessageId || "").trim();

    const status =
      String(body?.status || "")
        .trim()
        .toUpperCase();

    const errorMessage =
      String(body?.errorMessage || "").trim();

    const allowed =
      new Set([
        "PENDING",
        "UNIDENTIFIED",
        "PROCESSING",
        "PROCESSED",
        "ERROR"
      ]);

    if (
      !Number.isFinite(id) ||
      id <= 0 ||
      !gmailMessageId ||
      !allowed.has(status)
    ) {
      return json({
        ok: false,
        error: "STATUT PREPA INVALIDE"
      }, 400);
    }

    const existing =
      await env.OPS_DB.prepare(`
        SELECT
          id,
          gmail_message_id,
          status
        FROM prepa_inbox
        WHERE id=?
          AND gmail_message_id=?
        LIMIT 1
      `)
      .bind(id, gmailMessageId)
      .first();

    if (!existing) {
      return json({
        ok: false,
        error: "PREPA INTROUVABLE"
      }, 404);
    }

    await env.OPS_DB.prepare(`
      UPDATE prepa_inbox
      SET
        status=?,
        error_message=?,
        processed_at=
          CASE
            WHEN ?='PROCESSED'
              THEN CURRENT_TIMESTAMP
            ELSE processed_at
          END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
        AND gmail_message_id=?
    `)
    .bind(
      status,
      status === "ERROR"
        ? errorMessage
        : "",
      status,
      id,
      gmailMessageId
    )
    .run();

    return json({
      ok: true,
      id,
      gmailMessageId,
      status
    });
  }



  /*
   * V50.5 — suppression totale d'un vol importé.
   * - supprime fiche D1 / PREPA / Notes / R2
   * - si deleteDrive=true, supprime directement le dossier Drive via OAuth Google avant la suppression D1.
   */
  if (
    url.pathname === "/api/prepa/flight" &&
    request.method === "DELETE"
  ) {
    const body=await request.json().catch(()=>null);
    const airline=String(body?.airline||"").trim().toUpperCase();
    const flightNumber=String(body?.flightNumber||"").replace(/\s+/g,"").trim().toUpperCase();
    const flightDate=String(body?.flightDate||"").trim();
    const deleteDrive=body?.deleteDrive===true;

    if(!airline||!flightNumber||!flightDate){
      return json({ok:false,error:"AIRLINE / FLIGHT / DATE MANQUANTS"},400);
    }

    const prepaRows=(await env.OPS_DB.prepare(`
      SELECT id,drive_folder_id,gmail_message_id
      FROM prepa_inbox
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline,flightNumber,flightDate).all()).results||[];

    const driveFolderIds=[...new Set(prepaRows.map(r=>String(r.drive_folder_id||"").trim()).filter(Boolean))];
    const driveStatus=await googleDriveStatus(env);
    let driveDeleteResult=null;

    if(deleteDrive){
      if(!driveStatus.configured){
        return json({
          ok:false,
          error:"GOOGLE DRIVE DIRECT NON CONFIGURÉ",
          driveDeleteConfigured:false,
          googleDrive:driveStatus
        },409);
      }

      driveDeleteResult=await trashDriveFoldersDirect(env,driveFolderIds);

      if(!driveDeleteResult.ok){
        return json({
          ok:false,
          error:"SUPPRESSION DRIVE INCOMPLÈTE",
          driveDeleteConfigured:true,
          driveDeleteResult
        },502);
      }
    }

    /*
     * Neutralisation AVANT suppression D1 :
     * les messages restent dans Gmail, mais toute nouvelle remontée
     * du Dispatcher sera ignorée par /api/prepa/import.
     */
    await suppressPrepaFlight(env,{
      airline,
      flightNumber,
      flightDate,
      prepaRows
    });

    const flightRows=(await env.OPS_DB.prepare(`
      SELECT identity
      FROM flights
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline,flightNumber,flightDate).all()).results||[];

    const identities=[...new Set(flightRows.map(r=>String(r.identity||"").trim()).filter(Boolean))];

    let deletedR2=0;
    for(const identity of identities){
      const attachments=(await env.OPS_DB.prepare(`
        SELECT id,r2_key
        FROM flight_attachments
        WHERE flight_identity=?
      `).bind(identity).all()).results||[];

      if(env.OPS_FILES){
        for(const att of attachments){
          const key=String(att.r2_key||"").trim();
          if(key){
            try{await env.OPS_FILES.delete(key);deletedR2++}catch(e){}
          }
        }
      }
      await env.OPS_DB.prepare("DELETE FROM flight_attachments WHERE flight_identity=?").bind(identity).run();
      await env.OPS_DB.prepare("DELETE FROM flight_notes WHERE flight_identity=?").bind(identity).run();
    }

    const fdel=await env.OPS_DB.prepare(`
      DELETE FROM flights
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline,flightNumber,flightDate).run();

    const pdel=await env.OPS_DB.prepare(`
      DELETE FROM prepa_inbox
      WHERE UPPER(airline)=?
        AND UPPER(REPLACE(flight_number,' ',''))=?
        AND flight_date=?
    `).bind(airline,flightNumber,flightDate).run();

    return json({
      ok:true,
      deleted:true,
      airline,
      flightNumber,
      flightDate,
      driveDeleteConfigured:driveStatus.configured,
      driveDeleteResult,
      neutralized:true,
      driveFolderIds,
      flightsDeleted:Number(fdel.meta?.changes||0),
      prepaDeleted:Number(pdel.meta?.changes||0),
      r2Deleted:deletedR2,
      identities
    });
  }


  /*
   * ALYZIA OPS -> lecture boîte PRÉPA
   */
  if (
    url.pathname === "/api/prepa" &&
    request.method === "GET"
  ) {

    const items =
      await getPrepaInbox(
        env,
        url
      );


    return json({
      ok: true,
      count: items.length,
      items
    });
  }


  return json({
    ok: false,
    error: "ROUTE PREPA INTROUVABLE"
  }, 404);
}

async function handleSariaBridge(request,env,url){
  if(!url.pathname.startsWith("/api/saria/"))return null;

  const subpath=url.pathname.replace(/^\/api\/saria/,"/api");
  const headers=new Headers(request.headers);
  headers.delete("host");

  let response;

  if(env.SARIA && typeof env.SARIA.fetch==="function"){
    const internal=new URL(request.url);
    internal.protocol="https:";
    internal.hostname="saria.internal";
    internal.pathname=subpath;

    response=await env.SARIA.fetch(new Request(internal.toString(),{
      method:request.method,
      headers,
      body:["GET","HEAD"].includes(request.method)?undefined:request.body
    }));
  }else{
    const target=new URL(subpath+url.search,SARIA_PUBLIC_ORIGIN);
    response=await fetch(target.toString(),{
      method:request.method,
      headers,
      body:["GET","HEAD"].includes(request.method)?undefined:request.body
    });
  }

  const outHeaders=new Headers(response.headers);
  outHeaders.set("Access-Control-Allow-Origin","*");
  outHeaders.set("X-ALYZIA-SARIA-BRIDGE",env.SARIA?"SERVICE-BINDING":"PUBLIC-FALLBACK");

  if(request.method==="GET"){
    outHeaders.set(
      "Cache-Control",
      subpath.includes("/layout")?"public, max-age=3600":"public, max-age=300"
    );
  }

  return new Response(response.body,{
    status:response.status,
    statusText:response.statusText,
    headers:outHeaders
  });
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);

    try{
      if(request.method==="OPTIONS")return json({ok:true});

      if(url.pathname.startsWith("/api/flights")){
        const result=await handleFlights(request,env,url);
        if(result)return result;
      }

      if(url.pathname.startsWith("/api/airline-profiles")){
        const result=await handleAirlineProfiles(request,env,url);
        if(result)return result;
      }

      if(url.pathname.startsWith("/api/flight-notes") ||
         url.pathname.startsWith("/api/flight-attachments")){
        const result=await handleFlightNotes(request,env,url);
        if(result)return result;
      }

      if(url.pathname.startsWith("/api/gmail") || url.pathname.startsWith("/api/import-pipeline")){
        const result=await handleGmailPipeline(request,env,url);
        if(result)return result;
      }

      if(url.pathname.startsWith("/api/prepa")){
        const result=await handlePrepa(request,env,url);
        if(result)return result;
      }

      if(url.pathname.startsWith("/api/saria/")){
        const result=await handleSariaBridge(request,env,url);
        if(result)return result;
      }

      const assetResponse=await env.ASSETS.fetch(request);
    const headers=new Headers(assetResponse.headers);
    if(url.pathname==="/" || url.pathname.endsWith(".html")){
      headers.set("Cache-Control","no-store, no-cache, must-revalidate, max-age=0");
      headers.set("Pragma","no-cache");
      headers.set("Expires","0");
    }
    return new Response(assetResponse.body,{
      status:assetResponse.status,
      statusText:assetResponse.statusText,
      headers
    });

    }catch(err){
      console.error("ALYZIA OPS V50.1",err);
      return json({
        ok:false,
        error:err?.message||String(err)
      },500);
    }
  }
};
