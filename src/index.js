// V50.28 RULE: INC/INCARRIAGE = INBOUND PAX; INBOUND SUMMARY = FLIGHT METADATA; route inbound terminates at main origin (CDG).
// V50.27 RULE: INCARRIAGE/INC = INBOUND PASSENGERS; INBOUND CUSTOMER SUMMARY = INBOUND FLIGHTS.
// Passenger dossier displays linked INBOUND/OUTBOUND flight exactly via the shared connection rows.
// ALYZIA OPS V50.28 · Generic Connections + Full Passenger Consolidation
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

  // LOT 5.2.1 — historique IMPORT GMAIL complet pour l'interface.
  // Par défaut on conserve 120 pour compatibilité, mais le BUILD140 demande 2000.
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 120)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));


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
    LIMIT ? OFFSET ?
  `;
  binds.push(limit, offset);


  const statement =
    env.OPS_DB.prepare(sql);

  const result =
    await statement.bind(...binds).all();


  const rows =
    Array.isArray(result.results)
      ? result.results
      : [];


  let items =
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

  // V3.5 : includePayload=1 reconstruit les pièces jointes depuis R2.
  // Les lignes GMAIL_AUTOPILOT ne stockent volontairement que les métadonnées dans prepa_inbox ;
  // le payload complet est fourni à la demande au moteur navigateur existant, sans gonfler D1.
  if(includePayload && env.OPS_FILES){
    const enriched=[];
    for(const item of items){
      try{
        const versions=(await env.OPS_DB.prepare(`
          SELECT version_id,filename_original,mime_type,file_size,r2_key
          FROM import_file_versions
          WHERE gmail_message_id=?
          ORDER BY created_at ASC
        `).bind(String(item.gmailMessageId||'')).all()).results||[];
        const payload=[];
        for(const v of versions){
          const obj=await env.OPS_FILES.get(String(v.r2_key||''));
          if(!obj)continue;
          const bytes=new Uint8Array(await obj.arrayBuffer());
          let bin='';
          const CH=0x8000;
          for(let i=0;i<bytes.length;i+=CH)bin+=String.fromCharCode(...bytes.subarray(i,i+CH));
          payload.push({name:String(v.filename_original||'prepa.bin'),mimeType:String(v.mime_type||'application/octet-stream'),size:Number(v.file_size||bytes.length),base64:btoa(bin),versionId:String(v.version_id||'')});
        }
        enriched.push({...item,attachments:payload.length?payload:item.attachments});
      }catch(e){enriched.push(item)}
    }
    items=enriched;
  }

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
  INJECTED:"ALYZIA/INJECTÉ",
  VALIDATED:"ALYZIA/VALIDÉ",
  REVIEW:"ALYZIA/À_REVOIR",
  DUPLICATE:"ALYZIA/IGNORÉ_DOUBLON",
  ERROR:"ALYZIA/ERREUR",
  ERROR_IMPORT:"ALYZIA/ERREUR IMPORT",
  ERROR_INJECT:"ALYZIA/ERREUR INJECTE",
  UPDATED:"ALYZIA/MIS_A_JOUR", // ancien libellé : retiré lors d'une transition V5.3
  SUPPRESSED:"ALYZIA/SUPPRIMÉ_NEUTRALISÉ"
};
const GMAIL_PIPELINE_STATE_KEYS=new Set(["RECEIVED","IMPORTED","INJECTED","VALIDATED","REVIEW","DUPLICATE","ERROR","ERROR_IMPORT","ERROR_INJECT"]);
let GMAIL_LABEL_ID_CACHE=null;

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
  if(/STAFF|REBATE|BOOKABLE|\bBS-SA\b/.test(p)||/STAFF|REBATE|BOOKABLE|\bBS-SA\b/.test(f))return "STAFF";
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

function isValidAirlineCodeV53(code){
  const c=String(code||"").toUpperCase().trim();
  return /^[A-Z0-9]{2}$/.test(c) && /[A-Z]/.test(c);
}
function extractFlightTokenV53(text){
  const src=String(text||"").toUpperCase();
  const re=/\b([A-Z0-9]{2})\s*[- ]?\s*(\d{1,4}[A-Z]?)\b/g;
  let m;
  while((m=re.exec(src))){
    const airline=String(m[1]||"").toUpperCase();
    if(!isValidAirlineCodeV53(airline))continue;
    const num=String(m[2]||"").toUpperCase();
    if(!/\d/.test(num))continue;
    return {airline,flightNumber:`${airline}${num}`};
  }
  return null;
}
function extractFlightDateTokenV53(text){
  const src=String(text||"").toUpperCase();
  // LOT 5.3.1 : les sujets historiques PREPASQ utilisent par ex.
  // SQ335/20260905/CDG 2026/09/02 14:49.
  // 20260905 = DATE DU VOL ; 2026/09/02 = horodatage du document/mail.
  // On prend donc d'abord la date compacte placée dans l'identité du vol.
  const d0=src.match(/(?:^|\b[A-Z0-9]{2}\s*[- ]?\s*\d{1,4}[A-Z]?\s*[\/_-])((?:20)\d{2})(\d{2})(\d{2})(?=[\/_-]|\b)/);
  if(d0)return `${d0[1]}-${d0[2]}-${d0[3]}`;
  const dCompact=src.match(/\b((?:20)\d{2})(\d{2})(\d{2})\b/);
  if(dCompact)return `${dCompact[1]}-${dCompact[2]}-${dCompact[3]}`;
  const d1y=src.match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})\b/);
  if(d1y){
    const yy=String(d1y[3]);
    const yyyy=yy.length===2?`20${yy}`:yy;
    const months={JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"};
    return `${yyyy}-${months[d1y[2]]}-${String(Number(d1y[1])).padStart(2,"0")}`;
  }
  const d1=src.match(/\b(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/);
  if(d1)return d1[1];
  const d2=src.match(/\b(20\d{2}[-_/]\d{2}[-_/]\d{2})\b/);
  return d2?String(d2[1]).replace(/[\/_]/g,"-"):"";
}
function detectMailFlight(subject,filename,body){
  // V5.3 : l'identité du vol ne doit jamais être déduite d'abord d'un horodatage de fichier.
  // Priorité stricte : SUJET -> CORPS MAIL -> NOM DE FICHIER.
  const sources=[String(subject||""),String(body||""),String(filename||"")];
  const out={airline:"",flightNumber:"",flightDate:""};
  for(const src of sources){
    const f=extractFlightTokenV53(src);
    if(f){out.airline=f.airline;out.flightNumber=f.flightNumber;break}
  }
  for(const src of sources){
    const d=extractFlightDateTokenV53(src);
    if(d){out.flightDate=d;break}
  }
  return out;
}

function isOperationalCandidateMailV53(subject,bodyText,parts,flightBase){
  // PREPASQ Historique est une source opérationnelle normale de backfill :
  // aucune exclusion par expéditeur ; les mêmes règles d'identité et de contenu s'appliquent.
  const subjectText=String(subject||"");
  const body=String(bodyText||"");
  const src=lot2Upper(`${subjectText}\n${body}`);
  const hasFlight=!!(flightBase?.airline&&flightBase?.flightNumber&&isValidAirlineCodeV53(flightBase.airline));
  if(!hasFlight)return false;
  if(/\bPREPA\b|\bCHECK\s+IN\s+INFORMATION\b|\bJFE\s+SCREEN\s+COPY\b|\bLIST\s+OF\s*:|\bALTEA\b|\bSSR\b|\bFQTV\b|\bETKT\b|\bOUTBOUND\b|\bINBOUND\b/.test(src))return true;
  return (parts||[]).some(p=>{
    const f=String(p?.filename||"").toLowerCase();
    const mime=String(p?.mimeType||"").toLowerCase();
    return /(?:altea_report|^pdf_.*(?:list|summary)|\.(?:pdf|eml|txt))/.test(f) || /(?:application\/pdf|message\/rfc822|text\/plain)/.test(mime);
  });
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
  if(GMAIL_LABEL_ID_CACHE?.has(name))return GMAIL_LABEL_ID_CACHE.get(name);
  const labels=await gmailFetch(env,"/labels");
  GMAIL_LABEL_ID_CACHE=new Map((labels.labels||[]).map(l=>[String(l.name||""),String(l.id||"")]));
  const found=GMAIL_LABEL_ID_CACHE.get(name);
  if(found)return found;
  const created=await gmailFetch(env,"/labels",{method:"POST",body:JSON.stringify({name,labelListVisibility:"labelShow",messageListVisibility:"show"})});
  if(created?.id)GMAIL_LABEL_ID_CACHE.set(name,String(created.id));
  return created.id;
}

async function applyGmailLabel(env,messageId,labelName){
  if(!messageId||!labelName)return;
  const labelId=await ensureGmailLabel(env,labelName);
  await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}/modify`,{method:"POST",body:JSON.stringify({addLabelIds:[labelId]})});
}

async function setGmailPipelineState(env,messageId,state,{archive=true}={}){
  const key=String(state||"").toUpperCase();
  if(!messageId||!GMAIL_PIPELINE_STATE_KEYS.has(key))return;
  if(!GMAIL_LABEL_ID_CACHE){
    const labels=await gmailFetch(env,"/labels");
    GMAIL_LABEL_ID_CACHE=new Map((labels.labels||[]).map(x=>[String(x.name||""),String(x.id||"")]));
  }
  const byName=GMAIL_LABEL_ID_CACHE;
  const desiredName=GMAIL_LABELS[key];
  let desiredId=byName.get(desiredName)||"";
  if(!desiredId){desiredId=await ensureGmailLabel(env,desiredName);byName.set(desiredName,desiredId)}
  const removeNames=Object.values(GMAIL_LABELS).filter(n=>n&&n!==desiredName);
  const removeLabelIds=removeNames.map(n=>byName.get(n)).filter(Boolean);
  if(archive && key!=="RECEIVED")removeLabelIds.push("INBOX");
  const uniqueRemove=[...new Set(removeLabelIds)].filter(id=>id&&id!==desiredId);
  await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}/modify`,{
    method:"POST",
    body:JSON.stringify({addLabelIds:[desiredId],removeLabelIds:uniqueRemove})
  });
  await env.OPS_DB.prepare(`UPDATE gmail_messages SET status=?,label_state=?,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(key,key,messageId).run().catch(()=>{});
}

async function clearAlyziaPipelineLabels(env,messageId){
  if(!messageId)return;
  if(!GMAIL_LABEL_ID_CACHE){
    const labels=await gmailFetch(env,"/labels");
    GMAIL_LABEL_ID_CACHE=new Map((labels.labels||[]).map(x=>[String(x.name||""),String(x.id||"")]));
  }
  const byName=GMAIL_LABEL_ID_CACHE;
  const remove=[...new Set(Object.values(GMAIL_LABELS).map(n=>byName.get(n)).filter(Boolean))];
  if(remove.length)await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}/modify`,{method:"POST",body:JSON.stringify({removeLabelIds:remove})});
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


function mailRawDateToIso(raw,receivedAt){
  raw=String(raw||"").toUpperCase().trim();
  if(/^20\d{2}-\d{2}-\d{2}$/.test(raw))return raw;
  const compact=raw.replace(/[\s\/_-]+/g,"");
  if(/^20\d{6}$/.test(compact))return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`;
  const months={JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"};
  const withYear=compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})$/);
  if(withYear){
    const yy=String(withYear[3]);
    const yyyy=yy.length===2?`20${yy}`:yy;
    return `${yyyy}-${months[withYear[2]]}-${String(Number(withYear[1])).padStart(2,"0")}`;
  }
  const m=compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/);
  if(!m)return raw;
  let y=new Date(receivedAt||Date.now()).getUTCFullYear();
  const ctxM=new Date(receivedAt||Date.now()).getUTCMonth()+1;
  const targetM=Number(months[m[2]]);
  if(ctxM===12 && targetM===1)y+=1;
  if(ctxM===1 && targetM===12)y-=1;
  return `${y}-${months[m[2]]}-${String(Number(m[1])).padStart(2,"0")}`;
}

function plainTextOperationalKindV53(subject,body){
  const src=lot2Upper(`${subject||""}\n${body||""}`);
  const tk=/\bTK\d{1,4}\b/.test(src) && /\bCHECK\s+IN\s+INFORMATION\b/.test(src);
  if(tk)return "TK_TEXT";
  const jfe=/\bJFE\s+SCREEN\s+COPY\b/.test(src);
  if(jfe)return "JFE_SCREEN_COPY";
  // V3.5: TW et autres prépas texte reconnues par identité vol + marqueurs opérationnels.
  // On ne change aucun parser spécifique : on transforme seulement le corps Gmail en vraie source importable.
  const hasFlight=/\b(?:[A-Z][A-Z0-9]|[0-9][A-Z0-9])\s?\d{2,4}\b/.test(src);
  const hasOps=/\b(?:PREPA|CHECK\s*IN|STD|ETD|ATD|BOARD(?:ING)?|CFG|CONFIG|PAX|SSR|LIST\s+OF|BOOKED|ACCEPTED|INBOUND|OUTBOUND|FQTV|ETKT|EMD)\b/.test(src);
  if(hasFlight && hasOps)return /\bTW\s?\d{2,4}\b/.test(src)?"TW_TEXT":"MAIL_BODY_TEXT";
  return "";
}
function isPlainTextOperationalMail(subject,body){return !!plainTextOperationalKindV53(subject,body)}

async function storeVirtualPlainTextImport(env,{messageId,subject,receivedAt,bodyText,flightBase}){
  const text=String(bodyText||"").replace(/\u0000/g,"").trim();
  // R3: ne jamais créer de source BODY vide/quasi vide.
  if(text.length<20 || !/[A-Z0-9]{4}/i.test(text))return {added:0,updated:0,duplicate:0,created:false};
  if(!isPlainTextOperationalMail(subject,text))return {added:0,updated:0,duplicate:0,created:false};

  const flight=detectMailFlight(subject,"jfe_screen_copy.txt",text);
  if(!flight.airline && flightBase)Object.assign(flight,flightBase);

  const airline=flight.airline||"UNK";
  const flightNumber=flight.flightNumber||"UNIDENTIFIED";
  const flightDate=mailRawDateToIso(flight.flightDate||flightBase?.flightDate||"UNKNOWN_DATE",receivedAt);
  const textKind=plainTextOperationalKindV53(subject,text);
  const docType=textKind==="TK_TEXT"?"TK_TEXT":(textKind==="TW_TEXT"?"TW_TEXT":"OPERATIONAL_INFO");
  const filename=textKind==="TK_TEXT"?"tk_prepa_plain_text.txt":(textKind==="TW_TEXT"?"tw_prepa_plain_text.txt":(textKind==="JFE_SCREEN_COPY"?"jfe_screen_copy_plain_text.txt":"mail_body_operational.txt"));
  const norm=normalizeFilename(filename);
  const bytes=new TextEncoder().encode(text);
  const sha=await sha256Hex(bytes);
  const fileId=`${airline}|${flightNumber}|${flightDate}|${docType}|${norm}`;
  const versionId=`${fileId}|${sha}`;
  const r2Key=`prepa/${flightDate}/${airline}/${flightNumber}/${messageId}/${sha}_${norm}`.replace(/\s+/g,"_");

  const existingVersion=await env.OPS_DB.prepare(`SELECT version_id FROM import_file_versions WHERE version_id=? LIMIT 1`).bind(versionId).first();
  if(existingVersion){
    await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"DUPLICATE_TEXT_BODY",after:{filename,sha}});
    return {added:0,updated:0,duplicate:1,created:false};
  }

  await env.OPS_FILES.put(r2Key,bytes,{httpMetadata:{contentType:"text/plain; charset=UTF-8"},customMetadata:{gmail_message_id:messageId,filename_original:filename,sha256:sha,document_type:docType,source:"GMAIL_BODY"}});

  const existingFile=await env.OPS_DB.prepare(`SELECT file_id,active_version_id FROM import_files WHERE file_id=? LIMIT 1`).bind(fileId).first();

  await env.OPS_DB.prepare(`
    INSERT INTO import_file_versions
      (version_id,file_id,gmail_message_id,attachment_id,filename_original,filename_normalized,mime_type,file_size,sha256,r2_key,document_time,received_at,status,is_active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'STORED', 1, CURRENT_TIMESTAMP)
  `).bind(versionId,fileId,messageId,"GMAIL_BODY",filename,norm,"text/plain",bytes.byteLength,sha,r2Key,receivedAt,receivedAt).run();

  if(existingFile){
    await env.OPS_DB.prepare(`UPDATE import_file_versions SET is_active=0 WHERE file_id=? AND version_id<>?`).bind(fileId,versionId).run();
    await env.OPS_DB.prepare(`UPDATE import_files SET active_version_id=?,status='UPDATED',latest_document_time=?,updated_at=CURRENT_TIMESTAMP WHERE file_id=?`).bind(versionId,receivedAt,fileId).run();
    await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"UPDATED_TEXT_BODY",before:{activeVersionId:existingFile.active_version_id},after:{filename,sha,r2Key}});
  }else{
    await env.OPS_DB.prepare(`
      INSERT INTO import_files
        (file_id,active_version_id,airline,flight_number,flight_date,document_type,filename_normalized,status,latest_document_time,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `).bind(fileId,versionId,airline,flightNumber,flightDate,docType,norm,"ADDED",receivedAt).run();
    await recordImportChange(env,{scope:"FILE",airline,flightNumber,flightDate,gmailMessageId:messageId,fileId,versionId,changeType:"ADDED_TEXT_BODY",after:{filename,sha,r2Key}});
  }

  await env.OPS_DB.prepare(`
    INSERT INTO import_jobs
      (job_id,job_type,priority,airline,flight_number,flight_date,file_id,version_id,gmail_message_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'QUEUED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(job_id) DO NOTHING
  `).bind(`PARSE|${versionId}`,"PARSE_FILE",5,airline,flightNumber,flightDate,fileId,versionId,messageId).run();

  return {added:existingFile?0:1,updated:existingFile?1:0,duplicate:0,created:true};
}

async function storeGmailMessage(env,messageId){
  await ensureGmailPipelineTables(env);

  const existing=await env.OPS_DB.prepare(`SELECT gmail_message_id,status FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  // V3.5 RECOVERY: un gmail_message_id déjà connu n'est PAS un doublon de contenu.
  // On rejoue le message afin que les corrections d'identité, corps texte, Drive et injection
  // puissent réparer les imports historiques. Le SHA-256 des versions reste l'unique dédoublonnage contenu.
  const replaying=!!existing;

  const message=await gmailFetch(env,`/messages/${encodeURIComponent(messageId)}?format=full`);
  const subject=extractHeader(message,"Subject");
  const sender=extractHeader(message,"From");
  const receivedAt=extractHeader(message,"Date");
  const bodyText=extractPlainBody(message);
  const parts=walkParts(message.payload,[]);
  const flightBase=detectMailFlight(subject,"",bodyText);
  const operational=isOperationalCandidateMailV53(subject,bodyText,parts,flightBase);

  await env.OPS_DB.prepare(`
    INSERT INTO gmail_messages
      (gmail_message_id,gmail_thread_id,history_id,internal_date,subject,sender,received_at,snippet,label_state,airline,flight_number,flight_date,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(gmail_message_id) DO UPDATE SET
      gmail_thread_id=excluded.gmail_thread_id,
      history_id=excluded.history_id,
      internal_date=excluded.internal_date,
      subject=excluded.subject,
      sender=excluded.sender,
      received_at=excluded.received_at,
      snippet=excluded.snippet,
      airline=CASE WHEN excluded.airline<>'' THEN excluded.airline ELSE gmail_messages.airline END,
      flight_number=CASE WHEN excluded.flight_number<>'' THEN excluded.flight_number ELSE gmail_messages.flight_number END,
      flight_date=CASE WHEN excluded.flight_date<>'' THEN excluded.flight_date ELSE gmail_messages.flight_date END,
      status=CASE WHEN gmail_messages.status IN ('VALIDATED','INJECTED') THEN gmail_messages.status ELSE excluded.status END,
      updated_at=CURRENT_TIMESTAMP
  `).bind(message.id||messageId,message.threadId||"",message.historyId||"",message.internalDate||"",subject,sender,receivedAt,message.snippet||"",operational?"RECEIVED":"IGNORED_NON_OPERATIONAL",flightBase.airline,flightBase.flightNumber,flightBase.flightDate,operational?"RECEIVED":"IGNORED_NON_OPERATIONAL").run();

  if(!operational){
    await clearAlyziaPipelineLabels(env,messageId).catch(()=>{});
    return {status:"IGNORED_NON_OPERATIONAL",messageId,attachments:parts.length,replaying};
  }

  await setGmailPipelineState(env,messageId,"RECEIVED",{archive:false}).catch(()=>{});
  let added=0,updated=0,duplicate=0,error=0,virtualText=0;

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

      // LOT 5.3.1 : un doublon n'est reconnu que si la version exacte existe,
      // donc même identité logique + même SHA-256. Même sujet/nom de fichier/vol/date
      // avec un contenu différent reste une nouvelle version à traiter normalement.
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

  try{
    const virtual=await storeVirtualPlainTextImport(env,{messageId,subject,receivedAt,bodyText,flightBase});
    if(virtual.created)virtualText++;
    added+=virtual.added||0;
    updated+=virtual.updated||0;
    duplicate+=virtual.duplicate||0;
  }catch(e){
    error++;
    await recordImportChange(env,{scope:"MESSAGE",gmailMessageId:messageId,changeType:"TEXT_BODY_ERROR",after:{error:String(e?.message||e)}}).catch(()=>{});
  }

  const finalStatus=error?"ERROR_IMPORT":(added||updated||virtualText)?"RECEIVED":duplicate?"DUPLICATE":"REVIEW";
  await env.OPS_DB.prepare(`UPDATE gmail_messages SET status=?,label_state=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(finalStatus,finalStatus,messageId).run();
  await setGmailPipelineState(env,messageId,finalStatus,{archive:true}).catch(()=>{});

  return {status:finalStatus,messageId,attachments:parts.length,virtualText,added,updated,duplicate,error};
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
  const errors=[];
  for(const m of messages){
    try{
      results.push(await storeGmailMessage(env,m.id));
    }catch(e){
      // LOT 5.2 : un mail défectueux ne bloque jamais le reste de la page.
      errors.push({messageId:String(m?.id||""),error:String(e?.message||e)});
    }
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
  return {
    ok:errors.length===0,
    query,
    maxMessages,
    processed:results.length,
    attempted:messages.length,
    failed:errors.length,
    nextPageToken:list.nextPageToken||"",
    results,
    errors
  };
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
    LIMIT 20
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

const LOT2_SPECIFIC_AIRLINES = new Set(["SQ","TK","BJ","VF","TW"]);

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

function lot2PdfBinaryToBytes(v){
  const str=String(v||"");
  const out=new Uint8Array(str.length);
  for(let i=0;i<str.length;i++)out[i]=str.charCodeAt(i)&255;
  return out;
}

function lot2StripPdfStreamNewlines(bytes){
  let a=0,b=bytes.length;
  if(bytes[a]===13 && bytes[a+1]===10)a+=2;
  else if(bytes[a]===10 || bytes[a]===13)a+=1;

  if(bytes[b-2]===13 && bytes[b-1]===10)b-=2;
  else if(bytes[b-1]===10 || bytes[b-1]===13)b-=1;

  return bytes.slice(a,b);
}

async function lot2InflatePdfStream(bytes){
  if(typeof DecompressionStream==="undefined")return null;

  const formats=["deflate","deflate-raw"];
  for(const format of formats){
    try{
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      const ab=await new Response(stream).arrayBuffer();
      if(ab && ab.byteLength)return new Uint8Array(ab);
    }catch(e){}
  }

  return null;
}

function lot2ExtractPdfStreamCandidates(pdfBytes){
  const raw=lot2DecodeLatin1(pdfBytes);
  const streams=[];

  const re=/(<<[\s\S]{0,2500}?\/FlateDecode[\s\S]{0,2500}?>>)\s*stream([\s\S]*?)endstream/g;
  let m;
  while((m=re.exec(raw))){
    const dict=String(m[1]||"");
    const body=lot2StripPdfStreamNewlines(lot2PdfBinaryToBytes(m[2]||""));
    streams.push({dict,bytes:body});
  }

  return streams;
}

function lot2ParsePdfToUnicodeMap(decodedText){
  const cmap={};
  const src=String(decodedText||"");

  for(const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)){
    const body=block[1]||"";
    for(const m of body.matchAll(/<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{2,12})>/g)){
      const from=m[1].toUpperCase();
      const to=m[2].toUpperCase();
      const ch=lot2PdfDecodeHexWithoutMap(to);
      if(ch)cmap[from]=ch;
    }
  }

  for(const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)){
    const body=block[1]||"";
    for(const m of body.matchAll(/<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{2,8})>\s*<([0-9A-Fa-f]{2,12})>/g)){
      const start=parseInt(m[1],16);
      const end=parseInt(m[2],16);
      const dest=parseInt(m[3],16);
      if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(dest))continue;
      if(end<start || end-start>300)continue;
      const width=m[1].length;
      for(let code=start;code<=end;code++){
        const from=code.toString(16).toUpperCase().padStart(width,"0");
        const to=(dest+(code-start)).toString(16).toUpperCase().padStart(4,"0");
        const ch=lot2PdfDecodeHexWithoutMap(to);
        if(ch)cmap[from]=ch;
      }
    }
  }

  return cmap;
}

function lot2PdfDecodeHexWithoutMap(hex){
  const clean=String(hex||"").replace(/[^0-9A-Fa-f]/g,"");
  if(clean.length<2)return "";

  try{
    // UTF-16BE fréquent dans ToUnicode.
    if(clean.length%4===0){
      let out="";
      for(let i=0;i<clean.length;i+=4){
        const cp=parseInt(clean.slice(i,i+4),16);
        if(cp)out+=String.fromCharCode(cp);
      }
      if(/[A-Za-z0-9 ]/.test(out))return out;
    }

    let ascii="";
    for(let i=0;i<clean.length;i+=2){
      const b=parseInt(clean.slice(i,i+2),16);
      if(Number.isFinite(b) && b!==0)ascii+=String.fromCharCode(b);
    }
    return ascii;
  }catch(e){
    return "";
  }
}

function lot2PdfDecodeHexWithMap(hex,cmap){
  const clean=String(hex||"").replace(/[^0-9A-Fa-f]/g,"").toUpperCase();
  if(!clean)return "";

  const map=cmap||{};
  if(Object.keys(map).length){
    // Les PDF Altea Type0 utilisent des codes CID sur 2 octets = 4 hex chars.
    let out="";
    for(let i=0;i<clean.length;i+=4){
      const code=clean.slice(i,i+4);
      if(code.length<4)continue;
      out+=map[code] ?? lot2PdfDecodeHexWithoutMap(code);
    }
    if(out.trim())return out;
  }

  return lot2PdfDecodeHexWithoutMap(clean);
}

function lot2PdfDecodeLiteralString(v){
  return String(v||"")
    .replace(/\\n/g,"\n")
    .replace(/\\r/g,"\n")
    .replace(/\\t/g," ")
    .replace(/\\b/g," ")
    .replace(/\\f/g," ")
    .replace(/\\([()\\])/g,"$1")
    .replace(/\\\d{1,3}/g," ");
}

function lot2ExtractPdfTextOperations(decodedText,cmap){
  const src=String(decodedText||"");
  const out=[];

  // Chaînes littérales : (texte) Tj / TJ
  for(const m of src.matchAll(/\((?:\\.|[^\\()]){1,}\)/g)){
    const v=lot2PdfDecodeLiteralString(m[0].slice(1,-1));
    if(/[A-Za-z0-9]{2}/.test(v))out.push(v);
  }

  // Chaînes hexadécimales : <002f002c...> Tj
  for(const m of src.matchAll(/<([0-9A-Fa-f]{4,})>/g)){
    const v=lot2PdfDecodeHexWithMap(m[1],cmap);
    if(/[A-Za-z0-9]{2}/.test(v))out.push(v);
  }

  return out.join("\n");
}

function lot2LooksLikeRealAlteaText(text){
  const up=lot2Upper(text);
  if(/\bLIST\s+OF\s*:/.test(up))return true;
  if(/\b(?:INBOUND|ONCARRIAGE)\s+CUSTOMER\s+SUMMARY\b/.test(up))return true;
  if(/\bGENERIC\s+REPORT\b/.test(up) && /\bJ\d{1,4}\b/.test(up))return true;
  if(/\d{1,3}\.[A-Z][A-Z' .-]+\/[A-Z][A-Z' .-]+/.test(up))return true;
  return false;
}

async function lot2ExtractPdfTextFromBytes(bytes){
  const streams=lot2ExtractPdfStreamCandidates(bytes);
  if(!streams.length){
    // PDF sans Flate stream : tenter uniquement les chaînes visibles non compressées.
    const raw=lot2DecodeLatin1(bytes);
    const text=lot2CleanText(lot2ExtractPdfTextOperations(raw,{}));
    return {text:lot2LooksLikeRealAlteaText(text)?text:"", readable:lot2LooksLikeRealAlteaText(text), reason:lot2LooksLikeRealAlteaText(text)?"PDF_TEXT_EXTRACTED_RAW":"PDF_TEXT_NOT_EXTRACTED"};
  }

  const decodedTexts=[];
  let inflated=0;

  for(const stream of streams){
    const dec=await lot2InflatePdfStream(stream.bytes);
    if(!dec)continue;
    inflated++;
    decodedTexts.push(lot2DecodeLatin1(dec));
  }

  if(!decodedTexts.length){
    return {text:"",readable:false,reason:"PDF_TEXT_NOT_EXTRACTED_FLATE_UNAVAILABLE"};
  }

  // Construire la table ToUnicode avant de décoder les streams de contenu.
  const cmap={};
  for(const txt of decodedTexts){
    Object.assign(cmap,lot2ParsePdfToUnicodeMap(txt));
  }

  const pieces=[];
  for(const txt of decodedTexts){
    const extracted=lot2ExtractPdfTextOperations(txt,cmap);
    if(lot2LooksLikeRealAlteaText(extracted))pieces.push(extracted);
  }

  const text=lot2CleanText(pieces.join("\n"));
  if(!text){
    return {text:"",readable:false,reason:`PDF_TEXT_NOT_EXTRACTED_INFLATED_${inflated}`};
  }

  return {text,readable:true,reason:"PDF_TEXT_EXTRACTED_FLATE_TOUNICODE"};
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
    return await lot2ExtractPdfTextFromBytes(bytes);
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
  ["INBOUND CUSTOMER SUMMARY","INBOUND_SUMMARY"],
  ["ONCARRIAGE CUSTOMER SUMMARY","OUTBOUND_SUMMARY"]
];

const LOT2_GENERIC_AIRLINE_LIST_MAPPINGS = {
  J2: [
    ["FQA","FQTV"],
    ["ONC","OUTBOUND"],
    ["INC","INBOUND"],
    ["WCH","WCH"],
    ["INBOUND CUSTOMER SUMMARY","INBOUND_SUMMARY"],
    ["ONCARRIAGE CUSTOMER SUMMARY","OUTBOUND_SUMMARY"]
  ],
  AH: [
    ["FQA","FQTV"],
    ["INC","INBOUND"],
    ["WCH","WCH"],
    ["BS-SA","STAFF"],
    ["INBOUND CUSTOMER SUMMARY","INBOUND_SUMMARY"],
    ["ONCARRIAGE CUSTOMER SUMMARY","OUTBOUND_SUMMARY"]
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
  /*
   * V50.15 — Class counts strict.
   * Ne jamais scanner tout le PDF : cela peut prendre J274 / J2809 pour une classe J.
   * Les classes viennent uniquement de l'en-tête LIST OF.
   *
   * Exemple autorisé :
   * LIST OF: FQA C0 Y14 TOTAL 14
   * LIST OF: ONC C2 Y13 TOTAL 15
   */
  const up=lot2Upper(text);
  const out={};
  const header=up.match(/\bLIST\s+OF\s*:\s*[^\n\r]{0,220}/);
  if(!header)return out;

  const h=header[0];
  for(const m of h.matchAll(/\b([FJCWSY])\s*(\d{1,4})\b/g)){
    const k=m[1];
    const n=Number(m[2]||0);
    if(Number.isFinite(n))out[k]=n;
  }

  return out;
}

function lot2IsConnectionSummaryList(listName,cardKey){
  const l=lot2Upper(listName);
  const c=lot2Upper(cardKey);
  return /(?:INBOUND|ONCARRIAGE)\s+CUSTOMER\s+SUMMARY/.test(l)
    || /^(?:INBOUND|OUTBOUND)_SUMMARY$/.test(c)
    || (/(?:INBOUND|OUTBOUND)/.test(c) && /CUSTOMER\s+SUMMARY/.test(l));
}

function lot2ExtractConnectionSummaryCounts(text){
  /*
   * V50.12 — Summary count fix.
   * Les rapports "INBOUND CUSTOMER SUMMARY" et "ONCARRIAGE CUSTOMER SUMMARY"
   * ne sont pas des listes nominatives. Il ne faut jamais compter J274/J2809
   * comme passagers.
   *
   * Format Altea observé :
   * FLTNR STA/STD DEP/ARR DEST CONX C Y C Y TTL
   * AV54 0655 BOG GYD 05H00 0 1 0 0 0
   * J2645 2015 SVX 01H10 2 6 2 1 0
   *
   * On additionne uniquement les deux premiers chiffres C/Y après CONX.
   */
  const up=lot2Upper(text);
  const out={C:0,Y:0};
  let rows=0;

  for(const line of up.split(/\n+/)){
    const r=line.trim().replace(/\s+/g," ");
    if(!r)continue;

    // Ignore headers and route labels.
    if(/^(FLTNR|BOOKED|TER:|GATE:|CDG-|INBOUND CONNECTION|OUTBOUND CONNECTION)/.test(r))continue;

    /*
     * Deux formats observés :
     * INBOUND  : AV54 0655 BOG GYD 05H00 0 1 0 0 0
     * OUTBOUND : J2645 2015 SVX 01H10 2 6 2 1 0
     *
     * On ne lit jamais les chiffres du numéro de vol.
     * On cherche le bloc CONX HHHMM puis les colonnes C/Y qui suivent.
     */
    const m=r.match(/^([A-Z0-9]{2,4}\d{1,4})\s+\d{3,4}\s+(?:(?:[A-Z]{3})\s+){1,2}\d{2}H\d{2}\s+(\d{1,4})\s+(\d{1,4})(?:\s+\d{1,4}){0,3}\b/);
    if(!m)continue;

    out.C+=Number(m[2]||0);
    out.Y+=Number(m[3]||0);
    rows++;
  }

  return {classCounts:out,total:out.C+out.Y,rows};
}

function lot2ExtractClassCountsForDocument(text,listName,cardKey){
  if(lot2IsConnectionSummaryList(listName,cardKey)){
    return lot2ExtractConnectionSummaryCounts(text).classCounts;
  }
  return lot2ExtractClassCounts(text);
}

function lot2ExtractPassengerCount(text,listName,cardKey){
  if(lot2IsConnectionSummaryList(listName,cardKey)){
    return lot2ExtractConnectionSummaryCounts(text).total;
  }

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


const LOTX_MONTHS={JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"};

function lot2DateRawToIso(dayMon,contextIso){
  const m=String(dayMon||"").toUpperCase().match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/);
  if(!m)return "";
  const day=String(Number(m[1])).padStart(2,"0");
  const mon=LOTX_MONTHS[m[2]];
  let year=Number(String(contextIso||"").slice(0,4))||new Date().getUTCFullYear();

  // Gestion passage mois: rapport fin août, vol 01SEP => même année.
  // Rapport fin décembre, vol 01JAN => année +1.
  const ctxMon=Number(String(contextIso||"").slice(5,7))||0;
  const targetMon=Number(mon);
  if(ctxMon===12 && targetMon===1)year+=1;
  if(ctxMon===1 && targetMon===12)year-=1;

  return `${year}-${mon}-${day}`;
}

function lot2DetectFlightDateFromReportLine(text,airline,flightNumber,currentIso){
  /*
   * V50.17 — date réelle du vol générique.
   * Ignore la date d'émission du rapport en haut à droite (ex: 30AUG2026 07:46Z).
   * Prend la date de la ligne vol :
   *   AH1003  01SEP  CDG STD1215
   */
  const up=lot2Upper(text).replace(/\r/g,"\n");
  const a=String(airline||"").toUpperCase();
  const f=String(flightNumber||"").toUpperCase();
  const num=f.replace(a,"");
  const variants=[f,`${a}${num}`,`${a} ${num}`].filter(Boolean).map(v=>v.replace(/\s+/g,"\\s*"));
  for(const line of up.split(/\n+/).slice(0,220)){
    const l=line.trim().replace(/\s+/g," ");
    if(!l)continue;
    if(!/STD\s*\d{3,4}/.test(l))continue;
    if(!new RegExp(`\\b(?:${variants.join("|")})\\b`).test(l.replace(/\s+/g,""))) {
      // fallback with spaces normalized
      if(!new RegExp(`\\b${a}\\s*${num}\\b`).test(l))continue;
    }
    const dm=l.match(/\b(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/);
    if(dm){
      const iso=lot2DateRawToIso(dm[1],currentIso);
      if(iso)return {iso,raw:dm[1],line:l};
    }
  }

  // Fallback plus permissif : AH1003 01SEP même si STD a sauté de l'extraction.
  const compact=up.slice(0,12000).replace(/\s+/g," ");
  const re=new RegExp(`\\b${a}\\s*${num}\\s+(\\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\\b`);
  const m=compact.match(re);
  if(m){
    const iso=lot2DateRawToIso(m[1],currentIso);
    if(iso)return {iso,raw:m[1],line:m[0]};
  }

  return {iso:"",raw:"",line:""};
}

async function lot2UpdateJobFlightDate(env,job,version,newIso,reason){
  /*
   * V50.18 — D1 schema safe.
   * import_file_versions n'a pas de colonne flight_date dans la migration Lot 1.
   * On ne modifie donc plus cette colonne.
   *
   * La date corrigée devient authoritative dans :
   * - gmail_messages.flight_date
   * - import_files.flight_date
   * - import_jobs.flight_date
   * - import_job_results.flight_date via effectiveFlightDate
   *
   * On conserve les ids techniques existants file_id/version_id/job_id même s'ils contiennent
   * l'ancienne date, pour éviter les conflits de clés primaires et ne rien casser.
   */
  if(!newIso || newIso===job.flight_date)return {changed:false,flightDate:job.flight_date};

  const oldDate=job.flight_date||"";
  const fileId=version.file_id||job.file_id||"";
  const versionId=version.version_id||job.version_id||"";
  const jobId=job.job_id||"";

  await env.OPS_DB.prepare(`
    UPDATE gmail_messages
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE gmail_message_id=?
  `).bind(newIso,job.gmail_message_id||version.gmail_message_id||"").run().catch(()=>{});

  await env.OPS_DB.prepare(`
    UPDATE import_files
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE file_id=?
  `).bind(newIso,fileId).run().catch(()=>{});

  await env.OPS_DB.prepare(`
    UPDATE import_jobs
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE job_id=?
  `).bind(newIso,jobId).run().catch(()=>{});

  await recordImportChange(env,{
    scope:"JOB",
    airline:job.airline,
    flightNumber:job.flight_number,
    flightDate:newIso,
    gmailMessageId:job.gmail_message_id,
    fileId:fileId,
    versionId:versionId,
    changeType:"FLIGHT_DATE_FROM_REPORT_LINE",
    before:{flightDate:oldDate,fileId,versionId,jobId},
    after:{flightDate:newIso,fileId,versionId,jobId,reason}
  }).catch(()=>{});

  return {
    changed:true,
    flightDate:newIso,
    fileId,
    versionId,
    jobId
  };
}


function lot2CleanClock(v){
  const s=String(v||"").trim();
  const m=s.match(/(\d{1,2})[:H.]?(\d{2})/);
  if(!m)return "";
  return `${String(Number(m[1])).padStart(2,"0")}:${m[2]}`;
}


function lot2PassengerClassFromCode(v){
  const s=String(v||"").toUpperCase().trim();
  if(!s)return "";
  return s[0]||"";
}

function lot2CleanPassengerName(v){
  return String(v||"")
    .replace(/\s+/g," ")
    .replace(/\b(MR|MRS|MS|MISS|MSTR)\b$/i," $1")
    .trim();
}

function lot2SplitNameTitle(full){
  const s=String(full||"").replace(/\s+/g," ").trim();
  const m=s.match(/\b(MR|MRS|MS|MISS|MSTR)\s*$/i);
  const title=m?m[1].toUpperCase():"";
  const name=title?s.replace(/\s+\b(MR|MRS|MS|MISS|MSTR)\s*$/i,"").trim():s;
  return {name,title};
}

function lot2SsrFromCard(cardKey,specific){
  const c=String(cardKey||"").toUpperCase();
  const s=String(specific||"").toUpperCase();
  if(c==="ETKT"||c==="EMD"||c==="MASTER")return [];
  if(c==="FQTV")return ["FQTV",s].filter(Boolean);
  if(c==="CHLD")return ["CHLD"];
  if(c==="INF")return ["INF"];
  if(c==="WCH")return [s||"WCH"];
  if(c==="INBOUND_SUMMARY"||c==="OUTBOUND_SUMMARY")return [];
  if(c==="INBOUND")return ["INBOUND",s].filter(Boolean);
  if(c==="OUTBOUND")return ["OUTBOUND",s].filter(Boolean);
  return [c,s].filter(Boolean);
}

function lot2ExtractPassengerItemsFromGenericList(text,listName,cardKey){
  /*
   * V50.23 — extraction nominative générique propre.
   * - MASTER/ALL CUSTOMERS : ticket ou TKNE jamais en SSR.
   * - FQTV : SSR=FQTV, catégorie=TAHAT/DJURDJURA, numéro carte séparé.
   * - WCH : SSR=WCHR/WCHS/...
   * - INC : noms liés au vol inbound réel.
   */
  const lines=String(text||"").replace(/\r/g,"\n").split(/\n+/);
  const items=[];
  const cKey=String(cardKey||"").toUpperCase();
  const lName=String(listName||"").toUpperCase();

  for(let i=0;i<lines.length;i++){
    const raw=String(lines[i]||"").replace(/\s+/g," ").trim();
    const m=raw.match(/^\s*(\d{1,3})\.\s*(.+?)\s+([MFACI])\s+([A-Z]{3})\s+([A-Z]{3})\s+([A-Z]{1,2}[A-Z0-9]?)\s*(.*)$/i);
    if(!m)continue;

    const seq=Number(m[1]);
    const split=lot2SplitNameTitle(lot2CleanPassengerName(m[2]));
    const name=split.name;
    const title=split.title;
    const gender=String(m[3]||"").toUpperCase();
    const passengerType=gender==="A"?"ADT":gender==="C"?"CHLD":gender==="I"?"INF":"";
    const origin=String(m[4]||"").toUpperCase();
    const destination=String(m[5]||"").toUpperCase();
    const cls=lot2PassengerClassFromCode(m[6]);
    const acceptance=String(m[6]||"").toUpperCase();
    const rest=String(m[7]||"").trim();

    const item={
      id:`${cKey||"GEN"}-${seq}-${name}`,
      seq,name,title,gender,passengerType,
      class:cls,cabinClass:cls,
      origin,destination,acceptance,
      specific:"",
      note:"",
      listName,
      cardKey:cKey,
      source:"GENERIC_LIST_OF",
      ssr:[]
    };

    if(cKey==="MASTER"){
      const tk=(rest.match(/\b(\d{10,})\b/)||[])[1]||"";
      if(tk)item.etkt=tk;
      item.specific="";
      item.note="";
      item.ssr=[];
    }else if(cKey==="ETKT"){
      const tk=(rest.match(/\b(\d{10,})\b/)||[])[1]||"";
      item.etkt=tk;
      item.documentNumber=tk;
      item.specific="";
      item.ssr=[];
    }else if(cKey==="EMD"){
      const emd=(rest.match(/\b(\d{10,}[A-Z0-9]*)\b/)||[])[1]||"";
      item.emd=emd;
      item.documentNumber=emd;
      item.specific="";
      item.ssr=[];
    }else if(cKey==="WCH"){
      const code=(rest.match(/\b(WCHR|WCHS|WCHC|WCMP|WCBD|WCLB)\b/i)||[])[1]||"WCH";
      item.specific=String(code).toUpperCase();
      item.category=item.specific;
      item.ssr=[item.specific];
      item.codes=rest.split(/\s+/).filter(Boolean);
      item.note=rest;
    }else if(cKey==="FQTV"){
      const tokens=rest.split(/\s+/).filter(Boolean);
      const tier=tokens.find(t=>!/^(ACCRUAL|AH\d{6,})$/i.test(t))||"FQA";
      const next1=String(lines[i+1]||"").trim();
      const next2=String(lines[i+2]||"").trim();
      const ffid=(next1.match(/\b[A-Z]{2}\d{6,}\b/i)||[])[0]||"";
      item.specific=String(tier||"FQA").toUpperCase();
      item.category=item.specific;
      item.fqtv={program:"AH",tier:item.specific,number:ffid,ffid};
      item.ssr=["FQTV"];
      item.note=[ffid,next2 && /ACCRUAL/i.test(next2)?"ACCRUAL":""].filter(Boolean).join(" · ");
    }else if(cKey==="INBOUND" || cKey==="OUTBOUND"){
      const conn=rest.match(/\b([IO])-([A-Z0-9]{2,5})\s+([A-Z]{3})\b/i);
      if(conn){
        item.connection={
          direction:conn[1].toUpperCase()==="I"?"INBOUND":"OUTBOUND",
          flight:conn[2].toUpperCase(),
          airport:conn[3].toUpperCase()
        };
        item.specific=`${item.connection.direction} ${item.connection.flight} ${item.connection.airport}`;
      }else{
        item.specific="";
      }
      item.ssr=[cKey];
      item.note=rest;
    }else if(cKey==="CHLD"){
      item.ssr=["CHLD"];
      item.specific="";
      item.note=rest;
    }else if(cKey==="INF"){
      item.ssr=["INF"];
      item.specific="";
      item.note=rest;
    }else{
      item.specific=rest;
      item.ssr=lot2SsrFromCard(cKey,item.specific);
      item.note=rest;
    }

    items.push(item);
  }

  return items;
}

function lot2FqtvCategories(passengerItems){
  const out={};
  for(const p of passengerItems||[]){
    const cat=String(p.category||p.specific||"FQA").toUpperCase()||"FQA";
    out[cat]=(out[cat]||0)+1;
  }
  return out;
}

function lot2ExtractConnectionRows(text,listName,cardKey){
  const rawCard=String(cardKey||"").toUpperCase();
  const c=rawCard==="INBOUND_SUMMARY"?"INBOUND":rawCard==="OUTBOUND_SUMMARY"?"OUTBOUND":rawCard;
  if(c!=="INBOUND" && c!=="OUTBOUND")return [];
  const rows=[];
  const up=lot2Upper(text);
  for(const line of up.split(/\n+/)){
    const r=line.trim().replace(/\s+/g," ");
    if(!r || /^(FLTNR|BOOKED|TER:|GATE:|CDG-|INBOUND CONNECTION|OUTBOUND CONNECTION)/.test(r))continue;
    const m=r.match(/\b([A-Z0-9]{2,5})\s+(\d{3,4})\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2}H[0-5]\d)\s+(\d{1,3})\s+(\d{1,3})\b/);
    if(m){
      rows.push({
        flight:m[1],
        time:lot2CleanClock(m[2]),
        from:m[3],
        to:m[4],
        conx:m[5],
        classCounts:{C:Number(m[6]),Y:Number(m[7])},
        direction:c
      });
    }
  }
  return rows;
}

function lot2ParseOperationalInfo(text,airline,flightNumber,currentIso){
  /*
   * V50.20 — OPERATIONAL_INFO strict.
   * Injection autorisée UNIQUEMENT :
   * - STD
   * - STA
   * - DUREE / duration depuis TOTAL ELAPSED TIME
   * - ROUTE dep/dest
   * - TYPE A/C
   * - CONFIGURATION / CAPACITY
   *
   * Ne pas injecter :
   * - BOARDING
   * - GATE
   * - ACCEPTANCE STATUS
   *
   * Exemple Amadeus :
   * SCHEDULED:
   *   12:15
   *   13:30
   * TOTAL ELAPSED TIME:
   *   02H15
   *
   * On conserve STD et STA en heures locales affichées par Altea.
   * La durée vient de TOTAL ELAPSED TIME, ce qui évite les erreurs timezone.
   */
  const raw=String(text||"").replace(/\r/g,"\n");
  const up=lot2Upper(raw);
  if(!/\bJFE\s+SCREEN\s+COPY\b/.test(up) && !/\bAIRCRAFT\b/.test(up))return null;

  const info={};
  const detectedDate=lot2DetectFlightDateFromReportLine(raw,airline,flightNumber,currentIso);
  if(detectedDate.iso)info.date=detectedDate.iso;

  // Route depuis bloc AIRPORT ou ligne CDG-ALG.
  const airportBlock=raw.match(/\bAIRPORT\s*:\s*([\s\S]{0,180}?)(?:\bELAPSED\s+TIME\b|\bSCHEDULED\b|\bTOTAL\s+ELAPSED\b)/i);
  if(airportBlock){
    const codes=(airportBlock[1].match(/\b[A-Z]{3}\b/g)||[]).filter(c=>!["STD","STA"].includes(c));
    if(codes.length>=2){
      info.dep=codes[0];
      info.dest=codes[1];
    }
  }
  let m=up.match(/\b([A-Z]{3})-([A-Z]{3})\b/);
  if(m){
    info.dep=info.dep||m[1];
    info.dest=info.dest||m[2];
  }

  // STD direct en haut.
  m=raw.match(/\bSTD\s*:\s*([0-2]?\d[:.]?\d{2})/i);
  if(m)info.std=lot2CleanClock(m[1]);

  // Bloc SCHEDULED : première heure = STD, deuxième heure = STA.
  const scheduledBlock=raw.match(/\bSCHEDULED\s*:\s*([\s\S]{0,180}?)(?:\bTOTAL\s+ELAPSED\s+TIME\b|\bCOMMENTS\b|\[|$)/i);
  if(scheduledBlock){
    const times=[...scheduledBlock[1].matchAll(/\b([0-2]?\d[:.]?\d{2})\b/g)].map(x=>lot2CleanClock(x[1])).filter(Boolean);
    if(times[0])info.std=info.std||times[0];
    if(times[1])info.sta=times[1];
  }

  // Parfois le texte réécrit "STD 12:15 / STD 13:30".
  if(!info.sta){
    const stdTimes=[...raw.matchAll(/\bSTD\s*[: ]\s*([0-2]?\d[:.]?\d{2})\b/gi)].map(x=>lot2CleanClock(x[1])).filter(Boolean);
    if(stdTimes[0])info.std=info.std||stdTimes[0];
    if(stdTimes[1])info.sta=stdTimes[1];
  }

  // Durée : source officielle = TOTAL ELAPSED TIME, pas différence simple STD/STA.
  m=raw.match(/\bTOTAL\s+ELAPSED\s+TIME\s*:\s*([\s\S]{0,80})/i);
  if(m){
    const dm=m[1].match(/\b(\d{1,2})H\s*([0-5]\d)\b/i) || m[1].match(/\b(\d{1,2})[:.]([0-5]\d)\b/);
    if(dm){
      const h=String(Number(dm[1])).padStart(2,"0");
      const mm=String(dm[2]).padStart(2,"0");
      info.duration=`${h}H${mm}`;
      info.durationMinutes=Number(dm[1])*60+Number(dm[2]);
    }
  }

  // Ligne avion : CDG-ALG |738 | |14 |165 |14 |165 |10
  // REG peut être vide. On ne doit jamais prendre "14" comme immatriculation.
  for(const line of up.split(/\n+/)){
    const l=line.trim();
    if(!/\b[A-Z]{3}-[A-Z]{3}\b/.test(l))continue;
    const clean=l.replace(/\|/g," ").replace(/\s+/g," ").trim();
    const t=clean.split(" ");
    const routeIdx=t.findIndex(x=>/^[A-Z]{3}-[A-Z]{3}$/.test(x));
    if(routeIdx<0 || !t[routeIdx+1])continue;

    const route=t[routeIdx].split("-");
    info.dep=info.dep||route[0];
    info.dest=info.dest||route[1];
    info.aircraft=t[routeIdx+1]; // TYPE A/C

    let p=routeIdx+2;
    if(t[p] && !/^\d+$/.test(t[p])){
      // immat renseignée explicitement uniquement si alphanum non numérique.
      // Pour AH1003, REG vide => on ne touche pas immat.
      p++;
    }

    const nums=t.slice(p).filter(x=>/^\d+$/.test(x)).map(Number);
    if(nums.length>=4){
      info.config={C:nums[0],Y:nums[1]};
      info.capacity={C:nums[2],Y:nums[3]};
    }
    break;
  }

    const has=Object.keys(info).length>0;
  return has?info:null;
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

    let effectiveFlightDate=String(job.flight_date||version.flight_date||"");
    let effectiveJobId=jobId;
    let effectiveFileId=version.file_id;
    let effectiveVersionId=version.version_id;

    if(parserMode==="GENERIC" && extracted.readable){
      const detectedDate=lot2DetectFlightDateFromReportLine(extracted.text,airline,job.flight_number||version.flight_number||"",effectiveFlightDate);
      if(detectedDate.iso && detectedDate.iso!==effectiveFlightDate){
        const upd=await lot2UpdateJobFlightDate(env,job,version,detectedDate.iso,detectedDate);
        effectiveFlightDate=upd.flightDate||detectedDate.iso;
        effectiveJobId=upd.jobId||effectiveJobId;
        effectiveFileId=upd.fileId||effectiveFileId;
        effectiveVersionId=upd.versionId||effectiveVersionId;
      }
    }

    const operationalInfo=extracted.readable?lot2ParseOperationalInfo(extracted.text,airline,job.flight_number||version.flight_number||"",effectiveFlightDate):null;
    const listName=lot2DetectListName(extracted.text,filename);
    const listMapping=operationalInfo && !listName && parserMode==="GENERIC"
      ? {cardKey:"OPERATIONAL_INFO",mappingScope:"OPERATIONAL_INFO",matchedListName:"JFE SCREEN COPY"}
      : (parserMode==="SPECIFIC_LOCKED"
        ? {cardKey:"SPECIFIC",mappingScope:"SPECIFIC_LOCKED",matchedListName:""}
        : lot2LookupListMapping(airline,listName));
    const cardKey=listMapping.cardKey;
    const documentType=cardKey==="OPERATIONAL_INFO"?"OPERATIONAL_INFO":lot2DocumentTypeFromCard(cardKey,filename,mime);
    const passengerCount=cardKey==="OPERATIONAL_INFO"?0:(extracted.readable?lot2ExtractPassengerCount(extracted.text,listName,cardKey):0);
    const classCounts=cardKey==="OPERATIONAL_INFO"?{}:(extracted.readable?lot2ExtractClassCountsForDocument(extracted.text,listName,cardKey):{});
    const passengerItems=(cardKey==="OPERATIONAL_INFO"||!extracted.readable||cardKey==="INBOUND_SUMMARY"||cardKey==="OUTBOUND_SUMMARY")?[]:lot2ExtractPassengerItemsFromGenericList(extracted.text,listName,cardKey);
    const connectionRows=(cardKey==="OPERATIONAL_INFO"||!extracted.readable)?[]:lot2ExtractConnectionRows(extracted.text,listName,cardKey);
    const fqtvCategories=cardKey==="FQTV"?lot2FqtvCategories(passengerItems):{};

    let resultStatus="CLASSIFIED";
    let changeType="DOC_CLASSIFIED";

    if(cardKey==="OPERATIONAL_INFO"){
      resultStatus="OPERATIONAL_INFO_READY";
      changeType="OPERATIONAL_INFO_READY";
    }else if(parserMode==="SPECIFIC_LOCKED"){
      resultStatus="READY_SPECIFIC_PARSER";
      changeType="SPECIFIC_READY"; // V3.5: conservé, parser existant inchangé; source désormais rejouable/archivable.
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
        : "GENERIC V50.23 : nettoyage SSR MASTER/TKNE, dossiers propres, inbound noms sur vol réel.",
      mappingScope:listMapping.mappingScope,
      matchedListName:listMapping.matchedListName,
      operationalInfo: operationalInfo||null,
      passengerItems,
      connectionRows,
      fqtvCategories
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
      effectiveJobId,effectiveVersionId,effectiveFileId,job.airline||"",job.flight_number||"",effectiveFlightDate||job.flight_date||"",
      parserMode,documentType,listName,cardKey,passengerCount,JSON.stringify(classCounts),lot2Preview(extracted.text),JSON.stringify(result),resultStatus
    ).run();

    await env.OPS_DB.prepare(`UPDATE import_file_versions SET status=? WHERE version_id=?`).bind(resultStatus,effectiveVersionId).run();
    await env.OPS_DB.prepare(`UPDATE import_files SET status=?, document_type=?, updated_at=CURRENT_TIMESTAMP WHERE file_id=?`).bind(resultStatus,documentType,effectiveFileId).run();
    await env.OPS_DB.prepare(`UPDATE import_jobs SET status='DONE', error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(effectiveJobId).run();

    await recordImportChange(env,{
      scope:"JOB",
      airline:job.airline,
      flightNumber:job.flight_number,
      flightDate:effectiveFlightDate||job.flight_date,
      gmailMessageId:job.gmail_message_id,
      fileId:effectiveFileId,
      versionId:effectiveVersionId,
      changeType,
      after:result
    });

    return {ok:true,jobId:effectiveJobId,status:resultStatus,airline:job.airline,flightNumber:job.flight_number,flightDate:effectiveFlightDate||job.flight_date,documentType,listName,cardKey,passengerCount,mappingScope:listMapping.mappingScope,matchedListName:listMapping.matchedListName};
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
    ORDER BY priority ASC, created_at DESC
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
  let cards={results:[]};
  try{
    await ensureLot3Tables(env);
    cards=await env.OPS_DB.prepare(`SELECT card_key,COUNT(*) AS count,SUM(passenger_count) AS passenger_count FROM flight_import_cards GROUP BY card_key ORDER BY card_key`).all();
  }catch(e){}
  return {ok:true,jobs:jobs.results||[],files:files.results||[],classified:results.results||[],flightCards:cards.results||[],recentChanges:recent.results||[]};
}


/* =========================================================
 * LOT 3 — Injection vers fiche vol
 * ========================================================= */

async function ensureLot3Tables(env){
  await ensureImportProcessorTables(env);
  await env.OPS_DB.batch([
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS flight_import_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity TEXT NOT NULL,
        airline TEXT NOT NULL,
        flight_number TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        card_key TEXT NOT NULL,
        list_name TEXT NOT NULL DEFAULT '',
        source_status TEXT NOT NULL DEFAULT 'ACTIVE',
        passenger_count INTEGER NOT NULL DEFAULT 0,
        class_counts_json TEXT NOT NULL DEFAULT '{}',
        version_id TEXT,
        file_id TEXT,
        job_id TEXT,
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(identity, card_key, list_name, version_id)
      )
    `),
    env.OPS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_flight_import_cards_identity ON flight_import_cards(identity,card_key,updated_at)`),
    env.OPS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_flight_import_cards_flight ON flight_import_cards(airline,flight_number,flight_date)`),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS flight_import_injections (
        result_job_id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'INJECTED',
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]);
}

function lot3IdentityFromRow(row){
  return [
    String(row?.flight_date||"").trim(),
    String(row?.airline||"").trim().toUpperCase(),
    String(row?.flight_number||"").trim().toUpperCase()
  ].join("|");
}

function lot3CardLabel(cardKey,listName){
  const c=lot2Upper(cardKey);
  const l=String(listName||"").trim();
  if(c==="FQTV")return "FQTV";
  if(c==="INBOUND")return l.includes("SUMMARY")?"INBOUND SUMMARY":"INBOUND";
  if(c==="OUTBOUND")return l.includes("SUMMARY")?"OUTBOUND SUMMARY":"OUTBOUND";
  if(c==="MASTER")return "BOOKED / MASTER";
  return c || l || "OTHER";
}

function lot3SafeResultJson(v){
  const x=safeJsonParse(v,{});
  return x && typeof x==="object"?x:{};
}

function lot3BuildImportCard(row){
  const result=lot3SafeResultJson(row.result_json);
  const classCounts=safeJsonParse(row.class_counts_json,{});
  return {
    cardKey:String(row.card_key||""),
    label:lot3CardLabel(row.card_key,row.list_name),
    listName:String(row.list_name||""),
    documentType:String(row.document_type||row.card_key||""),
    passengerCount:Number(row.passenger_count||0),
    classCounts,
    parserMode:String(row.parser_mode||""),
    status:String(row.status||""),
    mappingScope:String(result.mappingScope||""),
    matchedListName:String(result.matchedListName||""),
    source:{
      jobId:String(row.job_id||""),
      fileId:String(row.file_id||""),
      versionId:String(row.version_id||""),
      injectedAt:new Date().toISOString()
    },
    passengers:Array.isArray(result.passengerItems)?result.passengerItems:[],
    passengerItems:Array.isArray(result.passengerItems)?result.passengerItems:[],
    connectionRows:Array.isArray(result.connectionRows)?result.connectionRows:[],
    fqtvCategories:result.fqtvCategories||{},
    rules:"LOT3 : injection depuis import_job_results validé ; n'écrase pas les corrections manuelles."
  };
}


function lot3PaxKey(p){
  return String(p?.name||"").toUpperCase().replace(/[^A-Z0-9/]/g,"");
}


function lot3IsProtectedSpecificAirline(airline){
  return ["SQ","TK","TW","BJ"].includes(String(airline||"").trim().toUpperCase());
}

function lot3PaxNameKey(p){
  return String(p?.name||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}
function lot3PaxSeatKey(p){
  return String(p?.seat||"").trim().toUpperCase().replace(/\s+/g,"");
}
function lot3PaxClassKey(p){
  return String(p?.class||p?.cabinClass||"").trim().toUpperCase();
}
function lot3PaxPnrKey(p){
  return String(p?.pnr||p?.recordLocator||p?.record_locator||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
}
function lot3PaxEtktKeys(p){
  const vals=[];
  const add=v=>{
    if(v==null||v==="")return;
    if(Array.isArray(v)){v.forEach(add);return;}
    if(typeof v==="object"){
      add(v.number);add(v.documentNumber);add(v.document_number);add(v.id);return;
    }
    const s=String(v).toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(s)vals.push(s);
  };
  add(p?.etkt);add(p?.etkts);add(p?.tickets);add(p?.documentNumber);add(p?.documents?.etkt);
  return [...new Set(vals)];
}

/*
 * V50.26 — matching hiérarchique GENERIC uniquement.
 * Ordre : ETKT > PNR+NOM > NOM+SIÈGE > NOM+CLASSE > NOM unique.
 * SQ/TK/TW/BJ restent sur le comportement historique, sans aucun changement.
 */
function lot3FindPassengerIndex(passengers,incoming,airline){
  const list=Array.isArray(passengers)?passengers:[];
  if(lot3IsProtectedSpecificAirline(airline)){
    const k=lot3PaxKey(incoming);
    return list.findIndex(p=>lot3PaxKey(p)===k);
  }

  const et=lot3PaxEtktKeys(incoming);
  if(et.length){
    const hits=[];
    list.forEach((p,i)=>{if(lot3PaxEtktKeys(p).some(v=>et.includes(v)))hits.push(i)});
    if(hits.length===1)return hits[0];
  }

  const name=lot3PaxNameKey(incoming);
  const pnr=lot3PaxPnrKey(incoming);
  if(name&&pnr){
    const hits=[];list.forEach((p,i)=>{if(lot3PaxNameKey(p)===name&&lot3PaxPnrKey(p)===pnr)hits.push(i)});
    if(hits.length===1)return hits[0];
  }

  const seat=lot3PaxSeatKey(incoming);
  if(name&&seat){
    const hits=[];list.forEach((p,i)=>{if(lot3PaxNameKey(p)===name&&lot3PaxSeatKey(p)===seat)hits.push(i)});
    if(hits.length===1)return hits[0];
  }

  const cls=lot3PaxClassKey(incoming);
  if(name&&cls){
    const hits=[];list.forEach((p,i)=>{if(lot3PaxNameKey(p)===name&&lot3PaxClassKey(p)===cls)hits.push(i)});
    if(hits.length===1)return hits[0];
  }

  if(name){
    const hits=[];list.forEach((p,i)=>{if(lot3PaxNameKey(p)===name)hits.push(i)});
    if(hits.length===1)return hits[0];
  }
  return -1;
}


function lot3CleanImportedPassenger(p){
  const x={...(p||{})};
  const bad=/\b(?:MASTER|TKNE|AS)\b/i;

  // MASTER / TKNE / AS ne sont pas des SSR à afficher dans les dossiers.
  x.ssr=[...new Set((Array.isArray(x.ssr)?x.ssr:[])
    .map(v=>String(v||"").trim().toUpperCase())
    .filter(v=>v && !/^(MASTER|TKNE|AS)$/.test(v) && !/^\d{10,}/.test(v)))];

  // La spécificité doit être une vraie catégorie opérationnelle, pas un numéro billet.
  if(/^\d{10,}/.test(String(x.specific||"")) || bad.test(String(x.specific||"")) && !/^(TAHAT|DJURDJURA|WCHR|WCHS|WCHC|WCMP|WCBD|WCLB)$/i.test(String(x.specific||""))){
    x.specific="";
  }

  if(/^\d{10,}/.test(String(x.note||"")) || /\bMASTER\b/i.test(String(x.note||""))){
    x.note="";
  }

  delete x.document; // Colonne document inutile dans les listes génériques.
  return x;
}


function lot3CleanGenericTokenText(v){
  let s=String(v||"").trim();
  if(!s)return "";
  // Jamais afficher ces jetons techniques comme SSR / spécificité.
  s=s.replace(/\bMASTER\b/gi,"")
     .replace(/\bTKNE\b/gi,"")
     .replace(/\bAS\b/gi,"")
     .replace(/\bETK[TN]?[-\s]*\d{10,}\b/gi,"")
     .replace(/\bEMD[-\s]*\d{10,}[A-Z0-9]*\b/gi,"")
     .replace(/\b\d{10,}\b/g,"")
     .replace(/\s*[·,;/|-]\s*/g," · ")
     .replace(/(?:\s*·\s*){2,}/g," · ")
     .replace(/^\s*·\s*|\s*·\s*$/g,"")
     .replace(/\s+/g," ")
     .trim();
  return s;
}

function lot3CleanGenericSsrArray(v){
  const bad=new Set(["MASTER","TKNE","AS",""]);
  const out=[];
  for(const raw of (Array.isArray(v)?v:[v])){
    let s=String(raw||"").trim().toUpperCase();
    if(!s || bad.has(s))continue;
    if(/^\d{10,}$/.test(s))continue;
    if(/^ETK[TN]?[-\s]*\d{10,}/.test(s))continue;
    if(/^EMD[-\s]*\d{10,}/.test(s))continue;
    if(!out.includes(s))out.push(s);
  }
  return out;
}

function lot3CleanImportedPassengerStrict(p){
  const x={...(p||{})};
  x.name=String(x.name||"").replace(/\s+/g," ").trim();
  x.class=String(x.class||x.cabinClass||"").toUpperCase();
  x.cabinClass=x.class;
  x.title=String(x.title||"").toUpperCase();
  x.gender=String(x.gender||"").toUpperCase();
  x.passengerType=String(x.passengerType||"").toUpperCase();
  x.ssr=lot3CleanGenericSsrArray(x.ssr);
  x.specific=lot3CleanGenericTokenText(x.specific);
  x.note=lot3CleanGenericTokenText(x.note);
  if(x.cardKey==="MASTER"){
    x.ssr=[];x.specific="";x.note="";
  }
  if(x.cardKey==="ETKT"){
    x.ssr=[];x.specific="";x.note="";
  }
  if(x.cardKey==="EMD"){
    x.ssr=[];x.specific="";x.note="";
  }
  return x;
}

function lot3DedupePassengerArray(arr){
  const out=[];
  const map=new Map();
  for(const raw of Array.isArray(arr)?arr:[]){
    const p=lot3CleanImportedPassengerStrict(raw);
    const key=lot3PaxKey(p);
    if(!key)continue;
    if(map.has(key)){
      const idx=map.get(key);
      out[idx]=lot3MergePassengerInfo(out[idx],p);
    }else{
      map.set(key,out.length);
      out.push(p);
    }
  }
  return out;
}

function lot3CleanConnectionRows(rows,dir,base){
  const out=[];
  const byFlight=new Map();
  for(const raw of Array.isArray(rows)?rows:[]){
    const r={...(raw||{})};
    r.flight=String(r.flight||"").trim().toUpperCase();
    if(!r.flight || r.flight==="—" || r.flight==="-")continue;
    r.from=String(r.from||"").trim().toUpperCase();
    r.to=String(r.to||"").trim().toUpperCase();
    r.time=String(r.time||"").trim();
    r.passengers=lot3DedupePassengerArray(r.passengers||[]);
    const key=r.flight;
    if(!byFlight.has(key)){
      byFlight.set(key,out.length);
      out.push(r);
    }else{
      const cur=out[byFlight.get(key)];
      // Préférer la provenance réelle de la summary (ex YYZ) au faux CDG issu de la ligne INC.
      if((!cur.from || cur.from===base.dep) && r.from && r.from!==base.dep)cur.from=r.from;
      if(!cur.to && r.to)cur.to=r.to;
      if(!cur.time && r.time)cur.time=r.time;
      cur.conx=cur.conx||r.conx||"";
      cur.classCounts={...(cur.classCounts||{}),...(r.classCounts||{})};
      cur.passengers=lot3DedupePassengerArray([...(cur.passengers||[]),...(r.passengers||[])]);
      cur.paxCount=Math.max(Number(cur.paxCount||0),Number(r.paxCount||0),cur.passengers.length);
      cur.count=Math.max(Number(cur.count||0),Number(r.count||0),cur.passengers.length);
    }
  }
  return out;
}

function lot3SanitizeFlightGeneric(base){
  if(!base||typeof base!=="object")return base;
  base.passengers=lot3DedupePassengerArray(base.passengers||[]);
  if(base.common_lists&&typeof base.common_lists==="object"){
    Object.keys(base.common_lists).forEach(k=>{
      base.common_lists[k]=lot3DedupePassengerArray(base.common_lists[k]||[]);
    });
  }
  base.inbound=lot3CleanConnectionRows(base.inbound||[],"INBOUND",base);
  base.outbound=lot3CleanConnectionRows(base.outbound||[],"OUTBOUND",base);
  return base;
}
function lot3MergePassengerInfo(a,b){
  a=lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(a||{}));
  b=lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(b||{}));
  const out={...(a||{})};
  for(const [k,v] of Object.entries(b||{})){
    if(v==null || v==="")continue;
    if(k==="ssr"){
      out.ssr=[...new Set([...(Array.isArray(out.ssr)?out.ssr:[]),...(Array.isArray(v)?v:[v])].filter(Boolean))];
    }else if(k==="note"){
      const notes=[out.note,v].filter(Boolean).map(x=>String(x));
      out.note=[...new Set(notes)].join(" · ");
    }else if(k==="specific"){
      const vals=[out.specific,v].filter(Boolean).map(x=>String(x));
      out.specific=[...new Set(vals)].join(" · ");
    }else if(k==="fqtv"){
      out.fqtv={...(out.fqtv||{}),...(v||{})};
    }else if(!out[k]){
      out[k]=v;
    }
  }
  return out;
}

function lot3NormalizePassengerForUi(p,card){
  const x={...(p||{})};
  const c=String(card?.cardKey||x.cardKey||"").toUpperCase();
  x.name=String(x.name||"").trim();
  x.class=String(x.class||x.cabinClass||"").toUpperCase();
  x.title=String(x.title||"").toUpperCase();
  x.gender=String(x.gender||"").toUpperCase();

  if(c==="WCH"){
    x.ssr=[x.category||x.specific||"WCH"].filter(Boolean);
  }else if(c==="FQTV"){
    x.ssr=["FQTV"];
    if(!x.fqtv)x.fqtv={tier:x.category||x.specific||"FQA",number:x.ffid||""};
  }else if(c==="CHLD"){
    x.ssr=["CHLD"];
  }else if(c==="INF"){
    x.ssr=["INF"];
  }else if(c==="INBOUND"||c==="OUTBOUND"){
    x.ssr=[c];
  }else if(c==="EMD"||c==="ETKT"||c==="MASTER"){
    x.ssr=Array.isArray(x.ssr)?x.ssr:[];
  }else{
    x.ssr=[c].filter(Boolean);
  }

  if(c==="EMD" && !x.emd)x.emd=x.documentNumber||x.emd||"";
  if(c==="ETKT" && !x.etkt)x.etkt=x.documentNumber||x.etkt||"";
  x.sourceList=x.listName||card?.listName||"";
  x.imported=true;
  return lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(x));
}

function lot3UpsertPassengers(base,card){
  base.passengers=Array.isArray(base.passengers)?base.passengers:[];
  const items=Array.isArray(card?.passengerItems)?card.passengerItems:[];
  if(!items.length)return;

  const protectedFlow=lot3IsProtectedSpecificAirline(base.airline);
  const cardKey=String(card?.cardKey||"").toUpperCase();

  // Garde-fou absolu : on garde exactement l'ancien matching pour SQ/TK/TW/BJ.
  if(protectedFlow){
    const byKey=new Map(base.passengers.map((p,i)=>[lot3PaxKey(p),i]));
    for(const raw of items){
      const p=lot3NormalizePassengerForUi(raw,card);
      const key=lot3PaxKey(p);
      if(!key)continue;
      if(byKey.has(key)){
        const idx=byKey.get(key);
        base.passengers[idx]=lot3MergePassengerInfo(base.passengers[idx],p);
      }else if(cardKey==="MASTER" || !base.passengers.length || !byKey.has(key)){
        byKey.set(key,base.passengers.length);
        base.passengers.push(p);
      }
    }
    return;
  }

  const hasMasterAlready=!!base.imports?.cards?.MASTER || base.passengers.some(p=>p?._genericMaster===true);

  for(const raw of items){
    const p=lot3NormalizePassengerForUi(raw,card);
    if(!lot3PaxNameKey(p) && !lot3PaxEtktKeys(p).length)continue;

    const idx=lot3FindPassengerIndex(base.passengers,p,base.airline);
    if(idx>=0){
      const merged=lot3MergePassengerInfo(base.passengers[idx],p);
      if(cardKey==="MASTER"){
        merged._genericMaster=true;
        delete merged._genericProvisional;
      }
      base.passengers[idx]=merged;
      continue;
    }

    if(cardKey==="MASTER"){
      p._genericMaster=true;
      delete p._genericProvisional;
      base.passengers.push(p);
      continue;
    }

    // Avant l'arrivée du MASTER on garde temporairement l'information.
    // Dès que le MASTER est présent, une carte secondaire ne crée plus de faux dossier passager.
    if(!hasMasterAlready && !base.passengers.some(q=>q?._genericMaster===true)){
      p._genericProvisional=true;
      base.passengers.push(p);
    }
  }

  if(cardKey==="MASTER"){
    // La population MASTER est l'autorité du dossier passager générique.
    // Les lignes secondaires non rapprochées restent dans leurs cartes/listes mais ne créent pas de dossier fantôme.
    base.passengers=base.passengers.filter(p=>p?._genericMaster===true || p?._genericProvisional!==true);
  }
}

function lot3MergeFlightData(current,row,card){
  const base=lot3SanitizeFlightGeneric(current && typeof current==="object"?{...current}:{});
  const identity=lot3IdentityFromRow(row);

  base.date=base.date || String(row.flight_date||"");
  base.airline=base.airline || String(row.airline||"").toUpperCase();
  base.flight=base.flight || String(row.flight_number||"").toUpperCase();
  base.identity=base.identity || identity;

  const imports=base.imports && typeof base.imports==="object" && !Array.isArray(base.imports)
    ? {...base.imports}
    : {};

  const cards=imports.cards && typeof imports.cards==="object" && !Array.isArray(imports.cards)
    ? {...imports.cards}
    : {};

  const key=String(card.cardKey||"OTHER").toUpperCase();
  const previous=cards[key] && typeof cards[key]==="object" && !Array.isArray(cards[key]) ? cards[key] : null;

  // Protection corrections manuelles : si une carte porte manualLocked=true, on archive seulement la source.
  if(previous && previous.manualLocked===true){
    const sources=Array.isArray(previous.sources)?previous.sources.slice():[];
    sources.push(card);
    cards[key]={...previous,sources,serverUpdatedAt:new Date().toISOString()};
  }else{
    const sources=previous && Array.isArray(previous.sources)?previous.sources.slice():[];
    sources.push(card);

    // Si plusieurs sources d'une même carte existent, on garde le plus haut compteur en affichage
    // et toutes les sources restent consultables.
    const prevCount=Number(previous?.passengerCount||0);
    const nextCount=Number(card.passengerCount||0);
    const display=nextCount>=prevCount?card:previous;

    cards[key]={
      ...(display||card),
      passengerCount:Math.max(prevCount,nextCount),
      sources,
      serverUpdatedAt:new Date().toISOString()
    };
  }

  imports.cards=cards;
  imports.lastInjectionAt=new Date().toISOString();
  imports.lastInjectionLot="LOT3";
  imports.status="INJECTED";

  // Injection dans les structures déjà existantes de la fiche vol.
  base.common=base.common||{};
  base.common_lists=base.common_lists||{};
  base.booked=base.booked||{};

  lot3UpsertPassengers(base,card);

  if(card.cardKey==="MASTER"){
    Object.entries(card.classCounts||{}).forEach(([k,v])=>{
      const n=Number(v||0);
      if(n>0)base.booked[String(k).toUpperCase()]=n;
    });
  }

  const map={WCH:"WCH",CHLD:"CHLD",INF:"INF",EMD:"EMD",ETKT:"ETK",FQTV:"FQTV",STAFF:"STAFF",MEAL:"MEAL",UMNR:"UMNR",MAAS:"MAAS",INAD:"INAD",DEPA:"DEPA",DEPU:"DEPU"};
  const existingKey=map[String(card.cardKey||"").toUpperCase()];
  if(existingKey){
    const count=Number(card.passengerCount||0);
    if(count>0)base.common[existingKey]=Math.max(Number(base.common[existingKey]||0),count);
    if(Array.isArray(card.passengerItems)&&card.passengerItems.length){
      const old=Array.isArray(base.common_lists[existingKey])?base.common_lists[existingKey]:[];
      const seen=new Set(old.map(p=>[p.name,p.seat,p.class,p.specific,p.note].map(x=>String(x||"").toUpperCase()).join("|")));
      for(const p0 of card.passengerItems){
        const p=lot3NormalizePassengerForUi(p0,card);
        const masterIdx=lot3FindPassengerIndex(base.passengers||[],p,base.airline);
        const master=masterIdx>=0?(base.passengers||[])[masterIdx]:null;
        const merged=master?lot3MergePassengerInfo(master,p):p;
        const key=[merged.name,merged.seat,merged.class,merged.specific,merged.note].map(x=>String(x||"").toUpperCase()).join("|");
        if(!seen.has(key)){old.push(merged);seen.add(key);}
      }
      base.common_lists[existingKey]=old;
    }
  }


  if(["INBOUND","OUTBOUND","INBOUND_SUMMARY","OUTBOUND_SUMMARY"].includes(card.cardKey)){
    const isInbound=card.cardKey==="INBOUND" || card.cardKey==="INBOUND_SUMMARY";
    const isSummary=card.cardKey==="INBOUND_SUMMARY" || card.cardKey==="OUTBOUND_SUMMARY";
    const dir=isInbound?"inbound":"outbound";

    /*
     * V50.28 STRICT CONNECTION MODEL
     * SUMMARY = metadata vols uniquement.
     * INC / ONC = passagers uniquement.
     * La fiche vol expose ensuite UNE LIGNE PAR PASSAGER, comme SQ.
     */
    if(!isSummary && Array.isArray(card.passengerItems) && card.passengerItems.length){
      const summaryKey=isInbound?"INBOUND_SUMMARY":"OUTBOUND_SUMMARY";
      const summaryCard=cards[summaryKey]||null;
      const summaryRows=[];
      const srcs=summaryCard&&Array.isArray(summaryCard.sources)&&summaryCard.sources.length?summaryCard.sources:[summaryCard].filter(Boolean);
      for(const s of srcs){
        for(const r of (Array.isArray(s?.connectionRows)?s.connectionRows:[]))summaryRows.push(r);
      }
      if(!summaryRows.length && Array.isArray(summaryCard?.connectionRows))summaryRows.push(...summaryCard.connectionRows);
      const byFlight=new Map(summaryRows.filter(r=>r?.flight).map(r=>[String(r.flight).toUpperCase(),r]));

      base[dir]=Array.isArray(base[dir])?base[dir]:[];
      // Remove prior generic rows produced by the same nominative list; summary rows are never displayed as pax rows.
      base[dir]=base[dir].filter(r=>{
        if(!r)return false;
        if(Array.isArray(r.passengers))return false;
        const src=String(r.sourceList||"").toUpperCase();
        return src!==String(card.listName||"").toUpperCase();
      });

      for(const p0 of card.passengerItems){
        const p=lot3NormalizePassengerForUi(p0,card);
        const conn=p.connection||{};
        const flight=String(conn.flight||"").trim().toUpperCase();
        if(!flight)continue;
        const meta=byFlight.get(flight)||{};
        const masterIdx=lot3FindPassengerIndex(base.passengers||[],p,base.airline);
        const master=masterIdx>=0?(base.passengers||[])[masterIdx]:null;
        const pax=master?lot3MergePassengerInfo(master,p):p;
        const airport=String(conn.airport||"").trim().toUpperCase();
        const metaFrom=String(meta.from||"").trim().toUpperCase();
        const metaTo=String(meta.to||"").trim().toUpperCase();
        const from=isInbound
          ? ((metaFrom && metaFrom!==String(base.dep||"").toUpperCase() && metaFrom!==String(base.dest||"").toUpperCase())?metaFrom:(airport||metaFrom))
          : (String(base.dest||metaFrom||"").toUpperCase());
        const to=isInbound
          ? String(base.dep||"CDG").toUpperCase()
          : ((metaTo && metaTo!==String(base.dep||"").toUpperCase() && metaTo!==String(base.dest||"").toUpperCase())?metaTo:(airport||metaTo));
        const row={
          ...pax,
          passenger:pax.name||pax.fullName||"",
          name:pax.name||pax.fullName||"",
          flight,
          from,
          to,
          time:String(meta.time||"").trim(),
          conx:String(meta.conx||""),
          class:pax.class||pax.cabinClass||"",
          sourceList:card.listName,
          connection:{...conn,direction:isInbound?"INBOUND":"OUTBOUND",flight,airport}
        };
        const key=[flight,lot3PaxEtktKeys(pax)[0]||lot3PaxPnrKey(pax)||lot3PaxNameKey(pax),lot3PaxSeatKey(pax)].join("|");
        const idx=base[dir].findIndex(r=>[
          String(r.flight||"").toUpperCase(),
          lot3PaxEtktKeys(r)[0]||lot3PaxPnrKey(r)||lot3PaxNameKey(r),
          lot3PaxSeatKey(r)
        ].join("|")===key);
        if(idx>=0)base[dir][idx]=lot3MergePassengerInfo(base[dir][idx],row);
        else base[dir].push(row);
      }
    }
  }

  // V50.28: after every generic card, refresh all list snapshots from the consolidated master.
  if(!lot3IsProtectedSpecificAirline(base.airline)){
    for(const listKey of Object.keys(base.common_lists||{})){
      base.common_lists[listKey]=(base.common_lists[listKey]||[]).map(p=>{
        const idx=lot3FindPassengerIndex(base.passengers||[],p,base.airline);
        return idx>=0?lot3MergePassengerInfo(base.passengers[idx],p):p;
      });
    }
    for(const dir of ["inbound","outbound"]){
      base[dir]=(base[dir]||[]).map(p=>{
        const idx=lot3FindPassengerIndex(base.passengers||[],p,base.airline);
        return idx>=0?lot3MergePassengerInfo(base.passengers[idx],p):p;
      });
    }
  }

  base.imports=imports;
  return lot3SanitizeFlightGeneric(base);
}

async function lot3UpsertFlightCard(env,identity,row,card){
  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_cards
      (identity,airline,flight_number,flight_date,card_key,list_name,passenger_count,class_counts_json,version_id,file_id,job_id,result_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(identity,card_key,list_name,version_id) DO UPDATE SET
      passenger_count=excluded.passenger_count,
      class_counts_json=excluded.class_counts_json,
      file_id=excluded.file_id,
      job_id=excluded.job_id,
      result_json=excluded.result_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    identity,
    String(row.airline||"").toUpperCase(),
    String(row.flight_number||"").toUpperCase(),
    String(row.flight_date||""),
    String(row.card_key||""),
    String(row.list_name||""),
    Number(row.passenger_count||0),
    JSON.stringify(card.classCounts||{}),
    String(row.version_id||""),
    String(row.file_id||""),
    String(row.job_id||""),
    JSON.stringify(card)
  ).run();
}


function lot3MergeOperationalInfo(existing,row){
  /*
   * V50.20 — injection stricte OPERATIONAL_INFO.
   * On alimente uniquement les champs opérationnels validés :
   * STD/STA, ROUTE, TYPE A/C, CONFIGURATION/CAPACITY, DUREE.
   */
  const result=lot3SafeResultJson(row.result_json);
  const info=result.operationalInfo||{};
  const x=existing && typeof existing==="object"?{...existing}:{};

  if(info.date)x.date=info.date;
  if(info.dep)x.dep=info.dep;
  if(info.dest)x.dest=info.dest;
  if(info.std)x.std=info.std;
  if(info.sta)x.sta=info.sta;
  if(info.durationMinutes!=null)x.duration=Number(info.durationMinutes); // UI durationText attend des minutes.
  if(info.duration)x.durationLabel=info.duration;
  if(info.durationMinutes!=null)x.durationMinutes=info.durationMinutes;
  if(info.aircraft)x.aircraft=info.aircraft;
  // REG/GATE restent manuels. Nettoyage uniquement si une ancienne mauvaise injection numérique existe.
  if(/^\d+$/.test(String(x.reg||"")))x.reg="";
  if(info.config)x.config={...(x.config||{}),...info.config};
  if(info.capacity)x.capacity={...(x.capacity||{}),...info.capacity};

  x.imports=x.imports||{};
  x.imports.operationalInfo={
    ...(x.imports.operationalInfo||{}),
    date:info.date||x.date||"",
    dep:info.dep||x.dep||"",
    dest:info.dest||x.dest||"",
    std:info.std||x.std||"",
    sta:info.sta||x.sta||"",
    duration:info.duration||x.duration||"",
    durationMinutes:info.durationMinutes??x.durationMinutes??null,
    aircraft:info.aircraft||x.aircraft||"",
    reg:info.reg||x.reg||"",
    config:info.config||x.config||{},
    capacity:info.capacity||x.capacity||{},
    source:{jobId:row.job_id,versionId:row.version_id,fileId:row.file_id},
    updatedAt:new Date().toISOString(),
    rules:"OPERATIONAL_INFO strict : STD/STA, route, type A/C, config/capacity, duration only."
  };
  x.imports.status="INJECTED";
  x.imports.lastInjectionAt=new Date().toISOString();
  x.imports.lastInjectionLot="LOT3_OPERATIONAL_INFO_V50_20";
  return x;
}

async function lot3InjectOperationalInfo(env,row,options={}){
  const identity=lot3IdentityFromRow(row);
  const existing=await getFlightByIdentity(env,identity);
  const before=existing?JSON.stringify(existing):null;
  if(!existing && !options.createMissingFlights){
    await env.OPS_DB.prepare(`UPDATE import_job_results SET status='WAITING_FLIGHT',updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(String(row.job_id||"")).run();
    await recordImportChange(env,{scope:"FLIGHT",airline:row.airline,flightNumber:row.flight_number,flightDate:row.flight_date,fileId:row.file_id,versionId:row.version_id,changeType:"OPERATIONAL_INFO_WAITING_FLIGHT",before:null,after:{identity,row}});
    return {ok:true,identity,airline:row.airline,flightNumber:row.flight_number,flightDate:row.flight_date,cardKey:"OPERATIONAL_INFO",listName:"JFE SCREEN COPY",passengerCount:0,status:"WAITING_FLIGHT"};
  }

  const afterFlight=lot3MergeOperationalInfo(existing,row);
  afterFlight.airline=afterFlight.airline||String(row.airline||"").toUpperCase();
  afterFlight.flight=afterFlight.flight||String(row.flight_number||"").toUpperCase();
  afterFlight.date=afterFlight.date||String(row.flight_date||"");
  await upsertFlight(env,afterFlight);

  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_injections
      (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(result_job_id) DO UPDATE SET
      identity=excluded.identity,status=excluded.status,before_json=excluded.before_json,after_json=excluded.after_json,updated_at=CURRENT_TIMESTAMP
  `).bind(String(row.job_id||""),identity,"INJECTED",before,JSON.stringify(afterFlight)).run();

  await env.OPS_DB.prepare(`UPDATE import_job_results SET status='INJECTED',updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(String(row.job_id||"")).run();

  await recordImportChange(env,{scope:"FLIGHT",airline:row.airline,flightNumber:row.flight_number,flightDate:row.flight_date,fileId:row.file_id,versionId:row.version_id,changeType:"OPERATIONAL_INFO_INJECTED",before:before?safeJsonParse(before,{}):null,after:{identity,operationalInfo:lot3SafeResultJson(row.result_json).operationalInfo||{}}});

  return {ok:true,identity,airline:row.airline,flightNumber:row.flight_number,flightDate:row.flight_date,cardKey:"OPERATIONAL_INFO",listName:"JFE SCREEN COPY",passengerCount:0,status:"INJECTED"};
}

async function lot3InjectOneResult(env,row,options={}){
  if(String(row.card_key||"")==="OPERATIONAL_INFO" || String(row.document_type||"")==="OPERATIONAL_INFO"){
    return await lot3InjectOperationalInfo(env,row,options);
  }
  const identity=lot3IdentityFromRow(row);
  const existing=await getFlightByIdentity(env,identity);
  const before=existing?JSON.stringify(existing):null;
  const card=lot3BuildImportCard(row);

  /*
   * V50.16 — No stub flight fix.
   * Ne jamais créer une fiche vol vide depuis un import partiel.
   * Si le vol n'existe pas encore dans la table flights, on stocke seulement
   * les cartes importées dans flight_import_cards et on marque WAITING_FLIGHT.
   * La fiche vol sera enrichie quand le vol réel sera présent.
   */
  if(!existing && !options.createMissingFlights){
    await lot3UpsertFlightCard(env,identity,row,card);

    await env.OPS_DB.prepare(`
      INSERT INTO flight_import_injections
        (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
      VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(result_job_id) DO UPDATE SET
        identity=excluded.identity,
        status=excluded.status,
        before_json=excluded.before_json,
        after_json=excluded.after_json,
        updated_at=CURRENT_TIMESTAMP
    `).bind(String(row.job_id||""),identity,"WAITING_FLIGHT",null,JSON.stringify({identity,card})).run();

    await env.OPS_DB.prepare(`
      UPDATE import_job_results
      SET status='WAITING_FLIGHT',
          updated_at=CURRENT_TIMESTAMP
      WHERE job_id=?
    `).bind(String(row.job_id||"")).run();

    await recordImportChange(env,{
      scope:"FLIGHT",
      airline:row.airline,
      flightNumber:row.flight_number,
      flightDate:row.flight_date,
      fileId:row.file_id,
      versionId:row.version_id,
      changeType:"FLIGHT_CARD_WAITING_FLIGHT",
      before:null,
      after:{identity,card}
    });

    return {
      ok:true,
      identity,
      airline:row.airline,
      flightNumber:row.flight_number,
      flightDate:row.flight_date,
      cardKey:row.card_key,
      listName:row.list_name,
      passengerCount:Number(row.passenger_count||0),
      status:"WAITING_FLIGHT"
    };
  }

  const afterFlight=lot3MergeFlightData(existing,row,card);

  await upsertFlight(env,afterFlight);
  await lot3UpsertFlightCard(env,identity,row,card);

  await env.OPS_DB.prepare(`
    INSERT INTO flight_import_injections
      (result_job_id,identity,status,before_json,after_json,created_at,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(result_job_id) DO UPDATE SET
      identity=excluded.identity,
      status=excluded.status,
      before_json=excluded.before_json,
      after_json=excluded.after_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(String(row.job_id||""),identity,"INJECTED",before,JSON.stringify(afterFlight)).run();

  await env.OPS_DB.prepare(`
    UPDATE import_job_results
    SET status='INJECTED',
        updated_at=CURRENT_TIMESTAMP
    WHERE job_id=?
  `).bind(String(row.job_id||"")).run();

  await recordImportChange(env,{
    scope:"FLIGHT",
    airline:row.airline,
    flightNumber:row.flight_number,
    flightDate:row.flight_date,
    fileId:row.file_id,
    versionId:row.version_id,
    changeType:"FLIGHT_CARD_INJECTED",
    before:before?safeJsonParse(before,{}):null,
    after:{identity,card}
  });

  return {
    ok:true,
    identity,
    airline:row.airline,
    flightNumber:row.flight_number,
    flightDate:row.flight_date,
    cardKey:row.card_key,
    listName:row.list_name,
    passengerCount:Number(row.passenger_count||0),
    status:"INJECTED"
  };
}

async function lot3InjectNext(env,body){
  await ensureLot3Tables(env);
  const limit=Math.max(1,Math.min(50,Number(body?.limit||10)));
  const airline=String(body?.airline||"").toUpperCase();
  const flight=String(body?.flight||body?.flightNumber||"").toUpperCase();
  const date=String(body?.date||body?.flightDate||"");

  const wh=[
    "status IN ('GENERIC_CARD_READY','GENERIC_MASTER_READY','GENERIC_CARD_OTHER','OPERATIONAL_INFO_READY')",
    "parser_mode='GENERIC'",
    "card_key IS NOT NULL",
    "card_key<>''",
    "card_key<>'NO_LIST'"
  ];
  const binds=[];
  if(airline){wh.push("airline=?");binds.push(airline)}
  if(flight){wh.push("flight_number=?");binds.push(flight)}
  if(date){wh.push("flight_date=?");binds.push(date)}
  binds.push(limit);

  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT *
    FROM import_job_results
    WHERE ${wh.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...binds).all();

  const injected=[];
  const options={createMissingFlights:body?.createMissingFlights===true};
  for(const row of results){
    injected.push(await lot3InjectOneResult(env,row,options));
  }

  return {ok:true,requested:limit,found:results.length,injected};
}

async function lot3FlightCards(env,url){
  await ensureLot3Tables(env);
  const identity=String(url.searchParams.get("identity")||"").trim();
  const airline=String(url.searchParams.get("airline")||"").toUpperCase();
  const flight=String(url.searchParams.get("flight")||"").toUpperCase();
  const date=String(url.searchParams.get("date")||"");

  const wh=[]; const binds=[];
  if(identity){wh.push("identity=?");binds.push(identity)}
  if(airline){wh.push("airline=?");binds.push(airline)}
  if(flight){wh.push("flight_number=?");binds.push(flight)}
  if(date){wh.push("flight_date=?");binds.push(date)}

  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT identity,airline,flight_number,flight_date,card_key,list_name,passenger_count,class_counts_json,version_id,file_id,job_id,result_json,updated_at
    FROM flight_import_cards
    ${wh.length?`WHERE ${wh.join(" AND ")}`:""}
    ORDER BY identity,card_key,list_name,updated_at DESC
    LIMIT 200
  `).bind(...binds).all();

  return {
    ok:true,
    count:results.length,
    cards:results.map(r=>({
      ...r,
      class_counts:safeJsonParse(r.class_counts_json,{}),
      result:safeJsonParse(r.result_json,{})
    }))
  };
}


/* =========================================================
 * ALYZIA OPS V50.29 — LOT 5 AUTO PILOT
 * ---------------------------------------------------------
 * But :
 * - synchroniser Gmail automatiquement
 * - traiter les jobs Lot 2
 * - créer la fiche vol depuis OPERATIONAL_INFO quand disponible
 * - injecter les cartes génériques Lot 3
 * - archiver les fichiers sources dans Google Drive
 * - alimenter PREPA / IMPORT GMAIL sans intervention manuelle
 *
 * VERROUILLAGE :
 * - SQ / TK / BJ / TW restent protégés par les Lots 2/3 existants.
 * - aucune règle parser spécifique n'est modifiée ici.
 * - le Cron appelle les mêmes fonctions validées que les routes manuelles.
 * ========================================================= */

// LOT 5.2 FULL MAILBOX CONTINUOUS — whole Gmail mailbox + newest-first + resumable pagination + non-blocking errors.
const LOT5_VERSION="V50.29_LOT5_AUTOPILOT_3_5_R4_CANONICAL_STATUS_VALIDATION";
// 5.3.5 scope: pipeline recovery + Gmail body + historical replay + Drive archive + fast summary.
// Specific parsers remain byte-for-byte untouched.
// Gmail -> identity -> R2/D1 -> Drive -> existing parser -> flight injection -> exclusive Gmail state.
// Parsers TK/BJ/VF/SQ/TW are intentionally untouched.
const LOT5_PROTECTED_AIRLINES=new Set(["SQ","TK","BJ","VF","TW"]);

async function ensureLot5Tables(env){
  await ensureLot3Tables(env);
  await ensurePrepaControlTables(env);
  await env.OPS_DB.batch([
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS lot5_autopilot_runs (
        run_id TEXT PRIMARY KEY,
        trigger_type TEXT NOT NULL DEFAULT 'CRON',
        status TEXT NOT NULL DEFAULT 'RUNNING',
        gmail_processed INTEGER NOT NULL DEFAULT 0,
        jobs_processed INTEGER NOT NULL DEFAULT 0,
        results_injected INTEGER NOT NULL DEFAULT 0,
        drive_files_uploaded INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS lot5_drive_folders (
        identity TEXT PRIMARY KEY,
        airline TEXT NOT NULL,
        flight_number TEXT NOT NULL,
        flight_date TEXT NOT NULL,
        airline_folder_id TEXT,
        date_folder_id TEXT,
        flight_folder_id TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`
      CREATE TABLE IF NOT EXISTS lot5_drive_files (
        version_id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        drive_file_id TEXT NOT NULL,
        drive_folder_id TEXT NOT NULL,
        filename TEXT,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.OPS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_lot5_drive_files_identity ON lot5_drive_files(identity,uploaded_at)`)
  ]);
}

function lot5Bool(v,def=true){
  if(v===undefined||v===null||v==='')return def;
  const x=String(v).trim().toLowerCase();
  if(["0","false","no","off"].includes(x))return false;
  if(["1","true","yes","on"].includes(x))return true;
  return def;
}

function lot5Config(env){
  return {
    enabled:lot5Bool(env.ALYZIA_AUTOPILOT_ENABLED,true),

    // LOT 5.2 FULL MAILBOX :
    // - aucune fenêtre newer_than
    // - toute la boîte Gmail, y compris archives / spam / corbeille via in:anywhere
    // - corps mail + JFE SCREEN COPY + PDF + TXT + EML sont tous collectés
    gmailQuery:String(env.ALYZIA_AUTOPILOT_GMAIL_QUERY||'in:anywhere').trim()||'in:anywhere',
    gmailMax:Math.max(1,Math.min(100,Number(env.ALYZIA_AUTOPILOT_GMAIL_MAX||100))),
    gmailPagesPerRun:Math.max(1,Math.min(3,Number(env.ALYZIA_AUTOPILOT_GMAIL_PAGES_PER_RUN||2))),

    processBatch:Math.max(1,Math.min(50,Number(env.ALYZIA_AUTOPILOT_PROCESS_BATCH||50))),
    processLoops:Math.max(1,Math.min(4,Number(env.ALYZIA_AUTOPILOT_PROCESS_LOOPS||4))),
    injectBatch:Math.max(1,Math.min(100,Number(env.ALYZIA_AUTOPILOT_INJECT_BATCH||100))),
    driveEnabled:lot5Bool(env.ALYZIA_AUTOPILOT_DRIVE_ENABLED,true),
    // Si ALYZIA_DRIVE_ROOT_FOLDER_ID est fourni, il est considéré comme le dossier PRÉPA cible.
    // Sinon AUTO PILOT cherche/réutilise automatiquement "PRÉPA" (ou "PREPA") dans Mon Drive.
    driveRootFolderId:String(env.ALYZIA_DRIVE_ROOT_FOLDER_ID||'root').trim()||'root'
  };
}

function lot5DriveEscapeQuery(v){
  return String(v||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

async function lot5DriveJson(env,path,opts={}){
  const token=await getGoogleDriveAccessToken(env);
  const resp=await fetch(`https://www.googleapis.com/drive/v3${path}`,{
    ...opts,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opts.headers||{})}
  });
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(data?.error?.message||`GOOGLE DRIVE HTTP ${resp.status}`);
  return data;
}

async function lot5FindChildFolder(env,parentId,name){
  const q=[
    `'${lot5DriveEscapeQuery(parentId)}' in parents`,
    `name='${lot5DriveEscapeQuery(name)}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`
  ].join(' and ');
  const p=new URLSearchParams({q,fields:'files(id,name)',pageSize:'10',spaces:'drive'});
  const data=await lot5DriveJson(env,`/files?${p.toString()}`);
  return data?.files?.[0]||null;
}

async function lot5EnsureDriveFolder(env,parentId,name){
  const existing=await lot5FindChildFolder(env,parentId,name);
  if(existing?.id)return String(existing.id);
  const data=await lot5DriveJson(env,'/files?fields=id,name',{method:'POST',body:JSON.stringify({
    name,
    mimeType:'application/vnd.google-apps.folder',
    parents:[parentId]
  })});
  if(!data?.id)throw new Error(`DRIVE DOSSIER NON CRÉÉ: ${name}`);
  return String(data.id);
}


function lot5CanonicalFlightDate(value,contextIso=''){
  const raw=String(value||'').trim().toUpperCase();
  if(!raw)return '';
  if(/^20\d{2}-\d{2}-\d{2}$/.test(raw))return raw;
  const compact=raw.replace(/[\s/_-]+/g,'');
  if(/^20\d{6}$/.test(compact))return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`;
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const withYear=compact.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|20\d{2})$/);
  if(withYear){
    const yy=String(withYear[3]);
    const yyyy=yy.length===2?`20${yy}`:yy;
    return `${yyyy}-${months[withYear[2]]}-${String(Number(withYear[1])).padStart(2,'0')}`;
  }
  if(/^\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(compact)){
    try{
      const iso=lot2DateRawToIso(compact,String(contextIso||'').slice(0,10));
      if(iso)return iso;
    }catch(e){}
    const m=compact.match(/^(\d{1,2})([A-Z]{3})$/);
    if(m){
      const year=Number(String(contextIso||'').slice(0,4))||new Date().getUTCFullYear();
      return `${year}-${months[m[2]]}-${String(Number(m[1])).padStart(2,'0')}`;
    }
  }
  return raw;
}

async function lot5ResolvePrepaRootFolder(env){
  const cfg=lot5Config(env);
  // Un ID explicite reste prioritaire : il doit pointer directement vers le dossier PRÉPA voulu.
  if(cfg.driveRootFolderId && cfg.driveRootFolderId!=='root')return cfg.driveRootFolderId;
  const root='root';
  const accented=await lot5FindChildFolder(env,root,'PRÉPA');
  if(accented?.id)return String(accented.id);
  const plain=await lot5FindChildFolder(env,root,'PREPA');
  if(plain?.id)return String(plain.id);
  return lot5EnsureDriveFolder(env,root,'PRÉPA');
}

function lot5ConcatBytes(parts){
  let total=0;
  for(const p of parts)total+=p.byteLength;
  const out=new Uint8Array(total);
  let o=0;
  for(const p of parts){out.set(p,o);o+=p.byteLength;}
  return out;
}

async function lot5UploadR2VersionToDrive(env,row,folderId){
  const object=await env.OPS_FILES.get(String(row.r2_key||''));
  if(!object)throw new Error(`R2 INTROUVABLE: ${row.r2_key||row.version_id}`);
  const ab=await new Response(object.body).arrayBuffer();
  const bytes=new Uint8Array(ab);
  const mime=String(row.mime_type||object.httpMetadata?.contentType||'application/octet-stream');
  const filename=String(row.filename_original||row.filename_normalized||'document').replace(/[\\/:*?"<>|]+/g,'_').trim()||'document';
  const boundary=`alyzia_${crypto.randomUUID().replace(/-/g,'')}`;
  const enc=new TextEncoder();
  const meta=JSON.stringify({name:filename,parents:[folderId]});
  const pre=enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post=enc.encode(`\r\n--${boundary}--`);
  const body=lot5ConcatBytes([pre,bytes,post]);
  const token=await getGoogleDriveAccessToken(env);
  const resp=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{
    Authorization:`Bearer ${token}`,
    'Content-Type':`multipart/related; boundary=${boundary}`
  },body});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||!data?.id)throw new Error(data?.error?.message||`DRIVE UPLOAD HTTP ${resp.status}`);
  return {id:String(data.id),name:String(data.name||filename)};
}

async function lot5FlightRoute(env,identity){
  try{
    const f=await getFlightByIdentity(env,identity);
    return {dep:String(f?.dep||f?.origin||'').toUpperCase(),dest:String(f?.dest||f?.destination||'').toUpperCase()};
  }catch(e){return {dep:'',dest:''}}
}

async function lot5EnsureFlightDriveFolder(env,{airline,flightNumber,flightDate,contextIso=''}){
  airline=String(airline||'').toUpperCase().trim();
  flightNumber=String(flightNumber||'').toUpperCase().replace(/\s+/g,'').trim();
  if(!isValidAirlineCodeV53(airline))throw new Error(`DRIVE CODE COMPAGNIE INVALIDE: ${airline||'VIDE'}`);
  if(!flightNumber.startsWith(airline) || !/^\d{1,4}[A-Z]?$/.test(flightNumber.slice(airline.length)))throw new Error(`DRIVE NUMÉRO VOL INVALIDE: ${flightNumber||'VIDE'}`);
  const canonicalDate=lot5CanonicalFlightDate(flightDate,contextIso);
  if(!canonicalDate||!/^20\d{2}-\d{2}-\d{2}$/.test(canonicalDate))throw new Error('DRIVE DATE VOL MANQUANTE/INVALIDE');
  const identity=[canonicalDate,airline,flightNumber].join('|');
  const cached=await env.OPS_DB.prepare(`SELECT * FROM lot5_drive_folders WHERE identity=? LIMIT 1`).bind(identity).first();
  if(cached?.flight_folder_id)return {identity,flightDate:canonicalDate,airlineFolderId:cached.airline_folder_id,dateFolderId:cached.date_folder_id,flightFolderId:cached.flight_folder_id};

  const prepaRootFolderId=await lot5ResolvePrepaRootFolder(env);
  const airlineFolderId=await lot5EnsureDriveFolder(env,prepaRootFolderId,airline);
  const dateFolderId=await lot5EnsureDriveFolder(env,airlineFolderId,canonicalDate);
  const route=await lot5FlightRoute(env,identity);
  const flightName=route.dep&&route.dest?`${flightNumber} ${route.dep}-${route.dest}`:flightNumber;
  const flightFolderId=await lot5EnsureDriveFolder(env,dateFolderId,flightName);

  await env.OPS_DB.prepare(`
    INSERT INTO lot5_drive_folders(identity,airline,flight_number,flight_date,airline_folder_id,date_folder_id,flight_folder_id,updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(identity) DO UPDATE SET airline_folder_id=excluded.airline_folder_id,date_folder_id=excluded.date_folder_id,flight_folder_id=excluded.flight_folder_id,updated_at=CURRENT_TIMESTAMP
  `).bind(identity,airline,flightNumber,canonicalDate,airlineFolderId,dateFolderId,flightFolderId).run();
  return {identity,flightDate:canonicalDate,airlineFolderId,dateFolderId,flightFolderId};
}

function lot5UiStatusFromGmailStateV53(state){
  const s=String(state||"").toUpperCase();
  if(s==="VALIDATED")return "VALIDATED";
  if(s==="INJECTED")return "INJECTED";
  if(s==="ERROR_IMPORT")return "ERROR_IMPORT";
  if(s==="ERROR_INJECT")return "ERROR_INJECT";
  if(s==="ERROR")return "ERROR";
  if(s==="REVIEW")return "REVIEW";
  if(s==="DUPLICATE")return "DUPLICATE";
  if(s==="IMPORTED")return "IMPORTED";
  if(s==="RECEIVED")return "RECEIVED";
  return s||"RECEIVED";
}

async function lot5RepairMessageIdentityV533(env,messageId){
  const gm=await env.OPS_DB.prepare(`SELECT gmail_message_id,subject,snippet,received_at,internal_date,airline,flight_number,flight_date FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  if(!gm)return null;
  // Sujet d'abord, puis snippet Gmail. Aucun nom de fichier horodaté ne peut écraser cette identité.
  const detected=detectMailFlight(String(gm.subject||''),'',String(gm.snippet||''));
  const airline=String(detected.airline||gm.airline||'').toUpperCase();
  const flightNumber=String(detected.flightNumber||gm.flight_number||'').toUpperCase().replace(/\s+/g,'');
  const flightDate=lot5CanonicalFlightDate(detected.flightDate||gm.flight_date||'',gm.received_at||gm.internal_date||'');
  if(!isValidAirlineCodeV53(airline) || !flightNumber.startsWith(airline) || !/^20\d{2}-\d{2}-\d{2}$/.test(flightDate))return {...gm,airline,flight_number:flightNumber,flight_date:flightDate,identityValid:false};

  const changed=airline!==String(gm.airline||'').toUpperCase() || flightNumber!==String(gm.flight_number||'').toUpperCase().replace(/\s+/g,'') || flightDate!==lot5CanonicalFlightDate(gm.flight_date||'',gm.received_at||gm.internal_date||'');
  if(changed){
    await env.OPS_DB.prepare(`UPDATE gmail_messages SET airline=?,flight_number=?,flight_date=?,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(airline,flightNumber,flightDate,messageId).run();
    // Réparer uniquement les lignes techniques de CE message. Aucun parser n'est modifié.
    await env.OPS_DB.prepare(`UPDATE import_files SET airline=?,flight_number=?,flight_date=?,updated_at=CURRENT_TIMESTAMP WHERE file_id IN (SELECT DISTINCT file_id FROM import_file_versions WHERE gmail_message_id=?)`).bind(airline,flightNumber,flightDate,messageId).run().catch(()=>{});
    await env.OPS_DB.prepare(`UPDATE import_jobs SET airline=?,flight_number=?,flight_date=?,updated_at=CURRENT_TIMESTAMP WHERE gmail_message_id=?`).bind(airline,flightNumber,flightDate,messageId).run().catch(()=>{});
    await env.OPS_DB.prepare(`UPDATE import_job_results SET airline=?,flight_number=?,flight_date=?,updated_at=CURRENT_TIMESTAMP WHERE job_id IN (SELECT job_id FROM import_jobs WHERE gmail_message_id=?)`).bind(airline,flightNumber,flightDate,messageId).run().catch(()=>{});
  }
  return {...gm,airline,flight_number:flightNumber,flight_date:flightDate,identityValid:true};
}

async function lot5DriveCoverageForMessageV533(env,messageId){
  const row=await env.OPS_DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN d.version_id IS NOT NULL THEN 1 ELSE 0 END) AS archived
    FROM import_file_versions v
    LEFT JOIN lot5_drive_files d ON d.version_id=v.version_id
    WHERE v.gmail_message_id=?
  `).bind(messageId).first();
  const total=Number(row?.total||0), archived=Number(row?.archived||0);
  return {total,archived,complete:total>0 && archived>=total};
}

async function lot5ReconcileOneGmailStateV53(env,messageId){
  let gm=await env.OPS_DB.prepare(`SELECT status,airline,flight_number,flight_date,subject,snippet,received_at,internal_date FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  if(!gm)return {messageId,state:"MISSING"};
  if(String(gm.status||"")==="IGNORED_NON_OPERATIONAL")return {messageId,state:"IGNORED_NON_OPERATIONAL"};
  gm=await lot5RepairMessageIdentityV533(env,messageId)||gm;
  const currentState=String(gm.status||"").toUpperCase();
  const transition=async(state)=>{if(currentState!==state)await setGmailPipelineState(env,messageId,state,{archive:state!=="RECEIVED"}).catch(()=>{})};
  if(!gm.identityValid && (!gm.airline||!gm.flight_number||!gm.flight_date||!isValidAirlineCodeV53(gm.airline))){
    await transition("REVIEW");
    return {messageId,state:"REVIEW"};
  }

  // 5.3.3 : un mail ne peut pas être déclaré IMPORTÉ tant que ses versions distinctes
  // ne sont pas réellement archivées dans Drive (si Drive est actif et connecté).
  const cfg=lot5Config(env);
  if(cfg.driveEnabled){
    const ds=await googleDriveStatus(env).catch(()=>({configured:false}));
    if(ds?.configured){
      const cov=await lot5DriveCoverageForMessageV533(env,messageId);
      if(cov.total>0 && !cov.complete){
        await transition("RECEIVED");
        return {messageId,state:"RECEIVED",drivePending:true,driveCoverage:cov};
      }
    }
  }
  const jobs=(await env.OPS_DB.prepare(`SELECT status,error_message,job_id FROM import_jobs WHERE gmail_message_id=?`).bind(messageId).all()).results||[];
  if(!jobs.length){
    const f=await env.OPS_DB.prepare(`SELECT COUNT(*) AS n FROM import_file_versions WHERE gmail_message_id=?`).bind(messageId).first();
    const state=Number(f?.n||0)>0?"IMPORTED":"REVIEW";
    await transition(state);
    return {messageId,state};
  }
  if(jobs.some(j=>String(j.status||"").toUpperCase()==="ERROR")){
    await transition("ERROR_IMPORT");
    return {messageId,state:"ERROR_IMPORT"};
  }
  const results=(await env.OPS_DB.prepare(`
    SELECT r.status,r.parser_mode,r.job_id
    FROM import_job_results r
    JOIN import_jobs j ON j.job_id=r.job_id
    WHERE j.gmail_message_id=?
  `).bind(messageId).all()).results||[];
  const jobStatuses=jobs.map(j=>String(j.status||"").toUpperCase());
  if(jobStatuses.some(x=>x==="QUEUED"||x==="PROCESSING")){
    await transition("RECEIVED");
    return {messageId,state:"RECEIVED",parsePending:true};
  }
  if(!results.length){
    await transition("REVIEW");
    return {messageId,state:"REVIEW",reason:"PARSER_DONE_WITHOUT_RESULT"};
  }
  const statuses=results.map(r=>String(r.status||"").toUpperCase());
  const generic=results.filter(r=>String(r.parser_mode||"").toUpperCase()==="GENERIC");
  const specific=results.filter(r=>String(r.parser_mode||"").toUpperCase()==="SPECIFIC_LOCKED");

  // LOT 5.3.2 — un parser spécifique verrouillé (SQ/TK/BJ/VF/TW) ne doit pas
  // envoyer le mail en À_REVOIR uniquement parce que la fiche vol n'existe pas encore.
  // Le document a bien été identifié/importé ; l'injection spécifique reste volontairement
  // hors de cette correction. À_REVOIR est réservé aux résultats GENERIC réellement bloqués.
  if(generic.some(r=>String(r.status||"").toUpperCase()==="WAITING_FLIGHT")){
    // Identité valide + document archivé : WAITING_FLIGHT signifie seulement que la fiche
    // n'existe pas encore. Ce n'est pas une ambiguïté et ne doit pas produire À_REVOIR.
    await transition("IMPORTED");
    return {messageId,state:"IMPORTED",waitingFlight:true};
  }
  // R4 — VALIDATION CANONIQUE : un mail est VALIDÉ lorsque tous ses résultats techniques
  // (GENERIC et/ou SPECIFIC_LOCKED) sont réellement INJECTED. Le Worker ne parse pas les
  // formats protégés lui-même : specific-browser-complete ne passe un résultat à INJECTED
  // qu'après confirmation de la persistance de la fiche vol par BUILD143+.
  const allInjected=results.length>0 && results.every(r=>String(r.status||"").toUpperCase()==="INJECTED");
  if(allInjected){
    await transition("VALIDATED");
    return {messageId,state:"VALIDATED",genericResults:generic.length,specificResults:specific.length};
  }
  if(results.some(r=>String(r.status||"").toUpperCase()==="INJECTED")){
    await transition("INJECTED");
    return {messageId,state:"INJECTED",partial:true,genericResults:generic.length,specificResults:specific.length};
  }
  // Un résultat spécifique non encore confirmé reste IMPORTÉ, jamais VALIDÉ artificiellement.
  await transition("IMPORTED");
  return {messageId,state:"IMPORTED",specificPending:specific.length>0};
}

async function lot5ReconcileGmailStatesV53(env,limit=200){
  const rows=(await env.OPS_DB.prepare(`
    SELECT gmail_message_id FROM gmail_messages
    WHERE status<>'IGNORED_NON_OPERATIONAL'
    ORDER BY updated_at ASC LIMIT ?
  `).bind(Math.max(1,Math.min(2000,Number(limit||500)))).all()).results||[];
  const counts={}; const errors=[];
  for(const r of rows){
    const id=String(r.gmail_message_id||""); if(!id)continue;
    try{const x=await lot5ReconcileOneGmailStateV53(env,id);counts[x.state]=(counts[x.state]||0)+1}
    catch(e){errors.push({messageId:id,error:String(e?.message||e)})}
  }
  return {ok:errors.length===0,checked:rows.length,counts,errors};
}

async function lot5PrepaStatusForMessage(env,messageId){
  const gm=await env.OPS_DB.prepare(`SELECT status FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  const state=lot5UiStatusFromGmailStateV53(gm?.status||"");
  if(state==="ERROR_IMPORT"){
    const er=await env.OPS_DB.prepare(`SELECT error_message FROM import_jobs WHERE gmail_message_id=? AND status='ERROR' ORDER BY updated_at DESC LIMIT 1`).bind(messageId).first();
    return {status:"ERROR_IMPORT",error:String(er?.error_message||"ERREUR IMPORT")};
  }
  if(state==="ERROR_INJECT")return {status:"ERROR_INJECT",error:"ERREUR INJECTION"};
  if(state==="REVIEW")return {status:"REVIEW",error:"IDENTITÉ OU INJECTION À REVOIR"};
  return {status:state||"RECEIVED",error:""};
}

async function lot5SyncPrepaInboxForMessage(env,messageId,driveFolderId=''){
  const gm=await env.OPS_DB.prepare(`SELECT * FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  if(!gm||!gm.airline||!gm.flight_number||!gm.flight_date)return;
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT v.version_id,v.filename_original,v.mime_type,v.file_size,d.drive_file_id
    FROM import_file_versions v
    LEFT JOIN lot5_drive_files d ON d.version_id=v.version_id
    WHERE v.gmail_message_id=?
    ORDER BY v.created_at DESC
  `).bind(messageId).all();
  const attachments=results.map(r=>({
    name:String(r.filename_original||''),
    mimeType:String(r.mime_type||''),
    size:Number(r.file_size||0),
    driveId:String(r.drive_file_id||'')
  }));
  await savePrepaInbox(env,{
    gmailMessageId:String(gm.gmail_message_id||''),
    gmailThreadId:String(gm.gmail_thread_id||''),
    source:'GMAIL_AUTOPILOT',
    detectionStatus:'IDENTIFIED',
    airline:String(gm.airline||'').toUpperCase(),
    flightNumber:String(gm.flight_number||'').toUpperCase(),
    flightDate:lot5CanonicalFlightDate(gm.flight_date,gm.received_at||gm.internal_date||''),
    subject:String(gm.subject||''),
    sender:String(gm.sender||''),
    receivedAt:String(gm.received_at||''),
    bodyText:String(gm.body_text||''),
    driveFolderId:String(driveFolderId||''),
    driveEmailPdfId:'',
    attachments
  });

  // LOT 5.1 — le backend AUTO PILOT est désormais le propriétaire du traitement.
  // Ne jamais laisser une ligne GMAIL_AUTOPILOT en PENDING : l'ancien moteur
  // navigateur V50.04 essaierait de la retraiter sans payload et générerait
  // "SOURCES PREPA DU GROUPE VIDES". On garde la ligne visible dans IMPORT GMAIL
  // avec le statut réel du pipeline backend.
  const ps=await lot5PrepaStatusForMessage(env,messageId);
  await env.OPS_DB.prepare(`
    UPDATE prepa_inbox
    SET status=?,
        error_message=?,
        processed_at=CASE WHEN ? IN ('IMPORTED','INJECTED','VALIDATED','DUPLICATE','ERROR_IMPORT','ERROR_INJECT','REVIEW') THEN COALESCE(processed_at,CURRENT_TIMESTAMP) ELSE processed_at END,
        updated_at=CURRENT_TIMESTAMP
    WHERE gmail_message_id=? AND source='GMAIL_AUTOPILOT'
  `).bind(ps.status,ps.error,ps.status,messageId).run();
}


async function lot5RepairIdentityBacklogV534(env,limit=1000){
  const rows=(await env.OPS_DB.prepare(`
    SELECT gmail_message_id FROM gmail_messages
    WHERE status<>'IGNORED_NON_OPERATIONAL'
    ORDER BY updated_at ASC
    LIMIT ?
  `).bind(Math.max(1,Math.min(2000,Number(limit||1000)))).all()).results||[];
  let checked=0,repaired=0,valid=0,invalid=0; const errors=[];
  for(const row of rows){
    const id=String(row.gmail_message_id||''); if(!id)continue;
    checked++;
    try{
      const before=await env.OPS_DB.prepare(`SELECT airline,flight_number,flight_date FROM gmail_messages WHERE gmail_message_id=?`).bind(id).first();
      const after=await lot5RepairMessageIdentityV533(env,id);
      if(after?.identityValid)valid++; else invalid++;
      if(after && (String(before?.airline||'')!==String(after.airline||'') || String(before?.flight_number||'')!==String(after.flight_number||'') || String(before?.flight_date||'')!==String(after.flight_date||''))) repaired++;
    }catch(e){errors.push({messageId:id,error:String(e?.message||e)})}
  }
  return {ok:errors.length===0,checked,repaired,valid,invalid,errors};
}

async function lot5StopRequestedV534(env){
  const row=await getIntegrationJson(env,'lot5_autopilot_stop_requested').catch(()=>null);
  return !!row?.requested;
}
async function lot5CheckpointV534(env,stage){
  if(await lot5StopRequestedV534(env)){
    const e=new Error(`AUTO PILOT ARRÊT DEMANDÉ @ ${stage}`); e.code='STOP_REQUESTED'; throw e;
  }
}

async function lot5AuditMessageV534(env,messageId){
  const gm=await env.OPS_DB.prepare(`SELECT * FROM gmail_messages WHERE gmail_message_id=? LIMIT 1`).bind(messageId).first();
  if(!gm)return {messageId,found:false};
  const versions=(await env.OPS_DB.prepare(`
    SELECT v.version_id,v.filename_original,v.mime_type,v.file_size,v.sha256,v.r2_key,
           d.drive_file_id,d.drive_folder_id,d.filename AS drive_filename
    FROM import_file_versions v
    LEFT JOIN lot5_drive_files d ON d.version_id=v.version_id
    WHERE v.gmail_message_id=? ORDER BY v.created_at ASC
  `).bind(messageId).all()).results||[];
  const jobs=(await env.OPS_DB.prepare(`SELECT job_id,status,job_type,file_id,version_id,error_message FROM import_jobs WHERE gmail_message_id=? ORDER BY created_at ASC`).bind(messageId).all()).results||[];
  const results=(await env.OPS_DB.prepare(`
    SELECT r.job_id,r.status,r.parser_mode,r.card_key,r.list_name,r.airline,r.flight_number,r.flight_date
    FROM import_job_results r JOIN import_jobs j ON j.job_id=r.job_id
    WHERE j.gmail_message_id=? ORDER BY r.updated_at ASC
  `).bind(messageId).all()).results||[];
  const prepa=await env.OPS_DB.prepare(`SELECT status,error_message,airline,flight_number,flight_date,drive_folder_id FROM prepa_inbox WHERE gmail_message_id=? ORDER BY updated_at DESC LIMIT 1`).bind(messageId).first().catch(()=>null);
  const identityValid=isValidAirlineCodeV53(gm.airline) && String(gm.flight_number||'').toUpperCase().startsWith(String(gm.airline||'').toUpperCase()) && /^20\d{2}-\d{2}-\d{2}$/.test(lot5CanonicalFlightDate(gm.flight_date,gm.received_at||gm.internal_date||''));
  let flight=null;
  if(identityValid){
    const identity=[lot5CanonicalFlightDate(gm.flight_date,gm.received_at||gm.internal_date||''),String(gm.airline||'').toUpperCase(),String(gm.flight_number||'').toUpperCase()].join('|');
    flight=await getFlightByIdentity(env,identity).catch(()=>null);
  }
  const driveArchived=versions.filter(v=>v.drive_file_id).length;
  return {
    messageId,found:true,subject:String(gm.subject||''),status:String(gm.status||''),
    identity:{airline:String(gm.airline||''),flightNumber:String(gm.flight_number||''),flightDate:String(gm.flight_date||''),valid:identityValid},
    acquisition:{versions:versions.length,r2Stored:versions.filter(v=>v.r2_key).length},
    drive:{archived:driveArchived,total:versions.length,complete:versions.length>0&&driveArchived===versions.length,folderId:String(prepa?.drive_folder_id||'')},
    parser:{jobsTotal:jobs.length,jobsDone:jobs.filter(j=>String(j.status||'').toUpperCase()==='DONE').length,jobsError:jobs.filter(j=>String(j.status||'').toUpperCase()==='ERROR').length,resultsTotal:results.length,modes:[...new Set(results.map(r=>String(r.parser_mode||'')))].filter(Boolean)},
    injection:{resultsInjected:results.filter(r=>String(r.status||'').toUpperCase()==='INJECTED').length,waitingFlight:results.filter(r=>String(r.status||'').toUpperCase()==='WAITING_FLIGHT').length,flightExists:!!flight},
    prepa:prepa||null,
    versions,jobs,results
  };
}

async function lot5AuditBacklogV534(env,limit=100){
  const rows=(await env.OPS_DB.prepare(`SELECT gmail_message_id FROM gmail_messages WHERE status<>'IGNORED_NON_OPERATIONAL' ORDER BY updated_at DESC LIMIT ?`).bind(Math.max(1,Math.min(500,Number(limit||100)))).all()).results||[];
  const summary={checked:0,received:0,imported:0,injected:0,validated:0,review:0,error:0,driveComplete:0,drivePending:0,flightMissing:0};
  const items=[];
  for(const r of rows){
    const a=await lot5AuditMessageV534(env,String(r.gmail_message_id||'')); if(!a?.found)continue;
    summary.checked++; const st=String(a.status||'').toUpperCase();
    if(st==='RECEIVED')summary.received++; else if(st==='IMPORTED')summary.imported++; else if(st==='INJECTED')summary.injected++; else if(st==='VALIDATED')summary.validated++; else if(st==='REVIEW')summary.review++; else if(st.startsWith('ERROR'))summary.error++;
    if(a.drive.complete)summary.driveComplete++; else if(a.acquisition.versions>0)summary.drivePending++;
    if(a.identity.valid && !a.injection.flightExists)summary.flightMissing++;
    items.push({messageId:a.messageId,subject:a.subject,status:a.status,identity:a.identity,drive:a.drive,parser:a.parser,injection:a.injection});
  }
  return {ok:true,summary,items};
}

async function lot5ArchiveDrive(env){
  const cfg=lot5Config(env);
  if(!cfg.driveEnabled)return {ok:true,skipped:true,reason:'DRIVE_DISABLED',uploaded:0,folders:0};
  const st=await googleDriveStatus(env);
  if(!st.configured)return {ok:true,skipped:true,reason:'DRIVE_NOT_CONFIGURED',uploaded:0,folders:0};

  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT v.version_id,v.gmail_message_id,v.filename_original,v.filename_normalized,v.mime_type,v.file_size,v.r2_key,v.received_at,
           COALESCE(NULLIF(g.airline,''),f.airline) AS airline,
           COALESCE(NULLIF(g.flight_number,''),f.flight_number) AS flight_number,
           COALESCE(NULLIF(g.flight_date,''),f.flight_date) AS flight_date
    FROM import_file_versions v
    JOIN import_files f ON f.file_id=v.file_id
    LEFT JOIN gmail_messages g ON g.gmail_message_id=v.gmail_message_id
    LEFT JOIN lot5_drive_files d ON d.version_id=v.version_id
    WHERE d.version_id IS NULL
      AND COALESCE(NULLIF(g.airline,''),f.airline) IS NOT NULL
      AND COALESCE(NULLIF(g.flight_number,''),f.flight_number) IS NOT NULL
      AND COALESCE(NULLIF(g.flight_date,''),f.flight_date) IS NOT NULL
    ORDER BY v.created_at ASC
    LIMIT 100
  `).all();

  let uploaded=0;
  const folders=new Set();
  const messages=new Map();
  const errors=[];
  for(const row of results){
    try{
      const airline=String(row.airline||'').toUpperCase();
      const flightNumber=String(row.flight_number||'').toUpperCase();
      const flightDate=lot5CanonicalFlightDate(row.flight_date,row.received_at||'');
      const folder=await lot5EnsureFlightDriveFolder(env,{airline,flightNumber,flightDate,contextIso:row.received_at||''});
      folders.add(folder.identity);
      const file=await lot5UploadR2VersionToDrive(env,row,folder.flightFolderId);
      await env.OPS_DB.prepare(`
        INSERT INTO lot5_drive_files(version_id,identity,drive_file_id,drive_folder_id,filename,uploaded_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(version_id) DO NOTHING
      `).bind(String(row.version_id),folder.identity,file.id,folder.flightFolderId,file.name).run();
      uploaded++;
      if(row.gmail_message_id)messages.set(String(row.gmail_message_id),folder.flightFolderId);
      await recordImportChange(env,{scope:'DRIVE',airline,flightNumber,flightDate,gmailMessageId:row.gmail_message_id,fileId:'',versionId:row.version_id,changeType:'LOT5_DRIVE_UPLOADED',after:{driveFileId:file.id,driveFolderId:folder.flightFolderId,filename:file.name}}).catch(()=>{});
    }catch(e){
      errors.push({versionId:String(row.version_id||''),error:String(e?.message||e)});
    }
  }
  for(const [messageId,folderId] of messages){
    await lot5SyncPrepaInboxForMessage(env,messageId,folderId).catch(()=>{});
  }
  return {ok:errors.length===0,uploaded,folders:folders.size,errors};
}

async function lot5SyncPrepaInboxRecent(env){
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT gmail_message_id,airline,flight_number,flight_date,received_at,internal_date FROM gmail_messages
    WHERE airline IS NOT NULL AND airline<>''
      AND flight_number IS NOT NULL AND flight_number<>''
      AND flight_date IS NOT NULL AND flight_date<>''
    ORDER BY updated_at DESC
    LIMIT 100
  `).all();
  let synced=0;
  for(const r of results){
    const id=String(r.gmail_message_id||'');
    if(!id)continue;
    let folderId='';
    const canonicalDate=lot5CanonicalFlightDate(r.flight_date,r.received_at||r.internal_date||'');
    const pf=await env.OPS_DB.prepare(`
      SELECT flight_folder_id
      FROM lot5_drive_folders
      WHERE airline=? AND flight_number=? AND flight_date=?
      ORDER BY updated_at DESC LIMIT 1
    `).bind(String(r.airline||'').toUpperCase(),String(r.flight_number||'').toUpperCase(),canonicalDate).first().catch(()=>null);
    folderId=String(pf?.flight_folder_id||'');
    await lot5SyncPrepaInboxForMessage(env,id,folderId).catch(()=>{});
    synced++;
  }
  return synced;
}

async function lot5InjectAvailable(env,cfg){
  let injected=0,waiting=0,errors=[];

  // 1) OPERATIONAL_INFO crée le vol réel lorsqu'il n'existe pas encore.
  const op=(await env.OPS_DB.prepare(`
    SELECT * FROM import_job_results
    WHERE parser_mode='GENERIC'
      AND card_key='OPERATIONAL_INFO'
      AND status IN ('OPERATIONAL_INFO_READY','WAITING_FLIGHT')
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(cfg.injectBatch).all()).results||[];
  for(const row of op){
    try{
      const r=await lot3InjectOneResult(env,row,{createMissingFlights:true});
      if(r?.status==='INJECTED')injected++; else waiting++;
    }catch(e){errors.push({jobId:row.job_id,error:String(e?.message||e)})}
  }

  // 2) Les cartes sont injectées uniquement sur une fiche vol existante.
  const cards=(await env.OPS_DB.prepare(`
    SELECT * FROM import_job_results
    WHERE parser_mode='GENERIC'
      AND card_key IS NOT NULL AND card_key<>'' AND card_key<>'NO_LIST' AND card_key<>'OPERATIONAL_INFO'
      AND status IN ('GENERIC_CARD_READY','GENERIC_MASTER_READY','GENERIC_CARD_OTHER','WAITING_FLIGHT')
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(cfg.injectBatch).all()).results||[];
  for(const row of cards){
    try{
      const r=await lot3InjectOneResult(env,row,{createMissingFlights:false});
      if(r?.status==='INJECTED')injected++; else waiting++;
    }catch(e){errors.push({jobId:row.job_id,error:String(e?.message||e)})}
  }
  return {ok:errors.length===0,injected,waiting,errors};
}


/* =========================================================
 * LOT 5.2 — FULL MAILBOX CONTINUOUS GMAIL SWEEP
 * ---------------------------------------------------------
 * Objectifs :
 * - parcourir toute la boîte Gmail sans filtre de date ;
 * - toujours lire d'abord la page la plus récente ;
 * - reprendre ensuite le backfill à partir du pageToken D1 ;
 * - limiter le nombre de pages par Cron pour ne pas bloquer le Worker ;
 * - une erreur sur un mail n'arrête jamais la page ni le cycle ;
 * - lorsque la fin de boîte est atteinte, le prochain Cron repart du début
 *   et détecte immédiatement les nouveaux mails.
 * ========================================================= */
async function lot5GmailContinuousSweep(env,cfg,{query='',maxMessages=0}={}){
  await ensureGmailPipelineTables(env);
  const q=String(query||cfg.gmailQuery||'in:anywhere').trim()||'in:anywhere';
  const pageSize=Math.max(1,Math.min(100,Number(maxMessages||cfg.gmailMax||100)));
  const pagesMax=Math.max(1,Math.min(10,Number(cfg.gmailPagesPerRun||5)));

  const state=await env.OPS_DB.prepare(`
    SELECT backfill_query,backfill_page_token,backfill_status
    FROM gmail_sync_state
    WHERE mailbox='me'
    LIMIT 1
  `).first().catch(()=>null);

  const sameQuery=String(state?.backfill_query||'')===q;
  const savedToken=sameQuery?String(state?.backfill_page_token||''):'';

  let processed=0,attempted=0,failed=0,pages=0;
  let newestNext='';
  let backfillNext=savedToken;
  const errors=[];

  // 1) Toujours la page la plus récente : les nouveaux mails ne doivent jamais
  // attendre la fin d'un backfill historique.
  try{
    const newest=await gmailSyncNow(env,{query:q,maxMessages:pageSize,pageToken:''});
    pages++;
    processed+=Number(newest.processed||0);
    attempted+=Number(newest.attempted||newest.processed||0);
    failed+=Number(newest.failed||0);
    newestNext=String(newest.nextPageToken||'');
    if(Array.isArray(newest.errors))errors.push(...newest.errors);

    // Si aucun backfill n'était en cours, la suite commence après la page récente.
    if(!backfillNext)backfillNext=newestNext;
  }catch(e){
    errors.push({scope:'NEWEST_PAGE',error:String(e?.message||e)});
  }

  // 2) Continuer l'historique sans jamais monopoliser un Cron entier.
  // La première page récente compte déjà dans pagesMax.
  while(backfillNext && pages<pagesMax){
    const token=backfillNext;
    try{
      const page=await gmailSyncNow(env,{query:q,maxMessages:pageSize,pageToken:token});
      pages++;
      processed+=Number(page.processed||0);
      attempted+=Number(page.attempted||page.processed||0);
      failed+=Number(page.failed||0);
      if(Array.isArray(page.errors))errors.push(...page.errors);
      backfillNext=String(page.nextPageToken||'');
    }catch(e){
      // Un problème de page est journalisé. On ne fait pas tomber tout AUTO PILOT.
      errors.push({scope:'BACKFILL_PAGE',pageToken:token,error:String(e?.message||e)});
      // On garde le token actuel pour retenter ce segment au prochain Cron.
      backfillNext=token;
      break;
    }
  }

  // gmailSyncNow met lui-même à jour gmail_sync_state à chaque page.
  // On force ici le curseur réellement retenu pour le prochain Cron.
  await env.OPS_DB.prepare(`
    INSERT INTO gmail_sync_state
      (mailbox,last_full_sync_at,backfill_query,backfill_page_token,backfill_status,updated_at)
    VALUES ('me',CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(mailbox) DO UPDATE SET
      last_full_sync_at=CURRENT_TIMESTAMP,
      backfill_query=excluded.backfill_query,
      backfill_page_token=excluded.backfill_page_token,
      backfill_status=excluded.backfill_status,
      updated_at=CURRENT_TIMESTAMP
  `).bind(q,backfillNext,backfillNext?'RUNNING':'DONE').run();

  return {
    ok:true, // les erreurs unitaires sont non bloquantes par conception
    query:q,
    pageSize,
    pagesProcessed:pages,
    processed,
    attempted,
    failed,
    backfillDone:!backfillNext,
    nextPageToken:backfillNext,
    errors
  };
}

async function lot5AutoPilotRun(env,{triggerType='MANUAL',gmailQuery='',gmailMax=0}={}){
  await ensureLot5Tables(env);
  const cfg=lot5Config(env);
  // Un seul AUTO PILOT à la fois. Les anciens RUNNING de plus de 10 min sont considérés abandonnés.
  await env.OPS_DB.prepare(`UPDATE lot5_autopilot_runs SET status='ERROR',error_message='STALE_RUN_RECOVERED',finished_at=CURRENT_TIMESTAMP WHERE status='RUNNING' AND started_at < datetime('now','-10 minutes')`).run().catch(()=>{});
  const activeRun=await env.OPS_DB.prepare(`SELECT run_id,trigger_type,started_at FROM lot5_autopilot_runs WHERE status='RUNNING' ORDER BY started_at DESC LIMIT 1`).first();
  if(activeRun)return {ok:false,alreadyRunning:true,error:'AUTO PILOT DÉJÀ EN COURS',activeRun,version:LOT5_VERSION};
  const runId=crypto.randomUUID();
  await env.OPS_DB.prepare(`INSERT INTO lot5_autopilot_runs(run_id,trigger_type,status,started_at) VALUES (?,?,'RUNNING',CURRENT_TIMESTAMP)`).bind(runId,triggerType).run();

  const details={version:LOT5_VERSION,config:{...cfg,driveRootFolderId:cfg.driveRootFolderId==='root'?'root':'CUSTOM'}};
  let gmailProcessed=0,jobsProcessed=0,resultsInjected=0,driveUploaded=0;
  try{
    if(!cfg.enabled)throw new Error('AUTO PILOT DÉSACTIVÉ');

    await setIntegrationJson(env,'lot5_autopilot_stop_requested',{requested:false,runId,updatedAt:new Date().toISOString()}).catch(()=>{});
    const gmail=await lot5GmailContinuousSweep(env,cfg,{
      query:gmailQuery||cfg.gmailQuery,
      maxMessages:gmailMax||cfg.gmailMax
    });
    details.gmail=gmail;
    gmailProcessed=Number(gmail.processed||0);
    await lot5CheckpointV534(env,'GMAIL');

    // 5.3.4 : réparer l'identité AVANT Drive et AVANT toute décision de statut.
    details.identityRepair=await lot5RepairIdentityBacklogV534(env,1200);
    await lot5CheckpointV534(env,'IDENTITY');

    // Archiver les sources physiques dès que l'identité canonique est disponible.
    const driveBefore=await lot5ArchiveDrive(env);
    details.driveBeforeParse=driveBefore;
    driveUploaded+=Number(driveBefore.uploaded||0);
    await lot5CheckpointV534(env,'DRIVE_BEFORE_PARSE');

    const processRuns=[];
    for(let i=0;i<cfg.processLoops;i++){
      const r=await lot2ProcessNext(env,{limit:cfg.processBatch});
      processRuns.push({found:r.found,processed:r.processed?.length||0});
      jobsProcessed+=Number(r.processed?.length||0);
      await lot5CheckpointV534(env,`PROCESS_${i+1}`);
      if(!r.found)break;
    }
    details.process=processRuns;

    const inj=await lot5InjectAvailable(env,cfg);
    details.inject=inj;
    resultsInjected=Number(inj.injected||0);
    await lot5CheckpointV534(env,'INJECT');

    // Deuxième passe Drive pour toute source devenue admissible pendant le traitement.
    const driveAfter=await lot5ArchiveDrive(env);
    details.driveAfterParse=driveAfter;
    details.drive={ok:!!(driveBefore.ok&&driveAfter.ok),uploaded:Number(driveBefore.uploaded||0)+Number(driveAfter.uploaded||0),errors:[...(driveBefore.errors||[]),...(driveAfter.errors||[])]};
    driveUploaded+=Number(driveAfter.uploaded||0);

    // Réconcilier un backlog large, pas seulement les 500 derniers messages.
    const labels=await lot5ReconcileGmailStatesV53(env,1500);
    details.gmailStates=labels;

    details.prepaSynced=await lot5SyncPrepaInboxRecent(env);
    details.audit=await lot5AuditBacklogV534(env,100);

    await env.OPS_DB.prepare(`
      UPDATE lot5_autopilot_runs
      SET status='DONE',gmail_processed=?,jobs_processed=?,results_injected=?,drive_files_uploaded=?,details_json=?,finished_at=CURRENT_TIMESTAMP
      WHERE run_id=?
    `).bind(gmailProcessed,jobsProcessed,resultsInjected,driveUploaded,JSON.stringify(details),runId).run();
    await setIntegrationJson(env,'lot5_autopilot_last_run',{runId,status:'DONE',finishedAt:new Date().toISOString(),details});
    return {ok:true,runId,...details,gmailProcessed,jobsProcessed,resultsInjected,driveUploaded};
  }catch(e){
    const error=String(e?.message||e);
    const stopped=String(e?.code||'')==='STOP_REQUESTED';
    const finalRunStatus=stopped?'STOPPED':'ERROR';
    details.error=error;
    await env.OPS_DB.prepare(`
      UPDATE lot5_autopilot_runs SET status=?,gmail_processed=?,jobs_processed=?,results_injected=?,drive_files_uploaded=?,error_message=?,details_json=?,finished_at=CURRENT_TIMESTAMP WHERE run_id=?
    `).bind(finalRunStatus,gmailProcessed,jobsProcessed,resultsInjected,driveUploaded,error,JSON.stringify(details),runId).run().catch(()=>{});
    await setIntegrationJson(env,'lot5_autopilot_last_run',{runId,status:finalRunStatus,finishedAt:new Date().toISOString(),details}).catch(()=>{});
    return {ok:false,stopped,runId,error,...details,gmailProcessed,jobsProcessed,resultsInjected,driveUploaded};
  }
}

async function lot5Status(env){
  await ensureLot5Tables(env);
  const cfg=lot5Config(env);
  const last=await env.OPS_DB.prepare(`SELECT * FROM lot5_autopilot_runs ORDER BY started_at DESC LIMIT 1`).first();
  const counters=await env.OPS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM import_jobs WHERE status='QUEUED') AS queuedJobs,
      (SELECT COUNT(*) FROM import_job_results WHERE status='WAITING_FLIGHT') AS waitingFlight,
      (SELECT COUNT(*) FROM lot5_drive_folders) AS driveFolders,
      (SELECT COUNT(*) FROM lot5_drive_files) AS driveFiles,
      (SELECT COUNT(*) FROM gmail_messages WHERE status='RECEIVED') AS gmailReceived,
      (SELECT COUNT(*) FROM gmail_messages WHERE status='IMPORTED') AS gmailImported,
      (SELECT COUNT(*) FROM gmail_messages WHERE status='REVIEW') AS gmailReview,
      (SELECT COUNT(*) FROM gmail_messages WHERE status='DUPLICATE') AS gmailDuplicate
  `).first();
  return {ok:true,version:LOT5_VERSION,config:{...cfg,driveRootFolderId:cfg.driveRootFolderId==='root'?'root':'CUSTOM'},lastRun:last?{...last,details:safeJsonParse(last.details_json,{})}:null,counters:counters||{},googleDrive:await googleDriveStatus(env)};
}


// R3 SPECIFIC BRIDGE: le Worker prépare/trace les sources READY_SPECIFIC_PARSER ;
// l'exécution du parser spécifique reste dans BUILD143, qui possède les parsers verrouillés inchangés.
async function lot5SpecificBrowserCompleteV535(env,body){
  const airline=String(body?.airline||'').trim().toUpperCase();
  const flightNumber=String(body?.flightNumber||body?.flight||'').trim().toUpperCase();
  const flightDate=lot5CanonicalFlightDate(body?.flightDate||body?.date||'');
  const messageIds=Array.isArray(body?.messageIds)?body.messageIds.map(x=>String(x||'')).filter(Boolean):[];
  if(!LOT5_PROTECTED_AIRLINES.has(airline)||!flightNumber||!flightDate)return {ok:false,error:'IDENTITÉ SPECIFIC INVALIDE'};
  // Le parser est exécuté dans BUILD143 avec le code existant inchangé ; ici on confirme uniquement
  // que son résultat a bien été persisté dans la fiche vol D1.
  const identity=[flightDate,airline,flightNumber].join('|');
  const flight=await getFlightByIdentity(env,identity).catch(()=>null);
  if(!flight)return {ok:false,error:'FICHE VOL D1 NON CONFIRMÉE'};
  const wh=["r.parser_mode='SPECIFIC_LOCKED'","r.airline=?","r.flight_number=?","r.flight_date=?","r.status='READY_SPECIFIC_PARSER'"];
  const binds=[airline,flightNumber,flightDate];
  if(messageIds.length){wh.push(`j.gmail_message_id IN (${messageIds.map(()=>'?').join(',')})`);binds.push(...messageIds)}
  const rows=(await env.OPS_DB.prepare(`SELECT r.job_id,j.gmail_message_id FROM import_job_results r JOIN import_jobs j ON j.job_id=r.job_id WHERE ${wh.join(' AND ')}`).bind(...binds).all()).results||[];
  for(const r of rows){
    await env.OPS_DB.prepare(`UPDATE import_job_results SET status='INJECTED',updated_at=CURRENT_TIMESTAMP WHERE job_id=?`).bind(String(r.job_id||'')).run();
  }
  const touched=[...new Set(rows.map(r=>String(r.gmail_message_id||'')).filter(Boolean))];
  for(const id of touched){await lot5ReconcileOneGmailStateV53(env,id).catch(()=>{});await lot5SyncPrepaInboxForMessage(env,id).catch(()=>{})}
  // R4 : recalcul canonique de tous les mails actuellement rattachés à cette identité.
  const sameFlight=(await env.OPS_DB.prepare(`SELECT gmail_message_id FROM gmail_messages WHERE UPPER(airline)=? AND UPPER(flight_number)=?`).bind(airline,flightNumber).all()).results||[];
  let reconciledIdentity=0;
  for(const m of sameFlight){
    const id=String(m.gmail_message_id||''); if(!id)continue;
    const gm=await env.OPS_DB.prepare(`SELECT flight_date,received_at,internal_date FROM gmail_messages WHERE gmail_message_id=?`).bind(id).first().catch(()=>null);
    if(lot5CanonicalFlightDate(gm?.flight_date,gm?.received_at||gm?.internal_date||'')!==flightDate)continue;
    await lot5ReconcileOneGmailStateV53(env,id).catch(()=>{});
    await lot5SyncPrepaInboxForMessage(env,id).catch(()=>{});
    reconciledIdentity++;
  }
  return {ok:true,r4:true,identity,confirmed:rows.length,messages:touched.length,reconciledIdentity};
}


async function lot5ArchiveDriveForMessagesV535(env,messageIds){
  const ids=[...new Set((messageIds||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,20);
  const cfg=lot5Config(env);
  if(!cfg.driveEnabled)return {ok:true,skipped:true,reason:'DRIVE_DISABLED',uploaded:0,folders:0};
  const st=await googleDriveStatus(env);
  if(!st.configured)return {ok:true,skipped:true,reason:'DRIVE_NOT_CONFIGURED',uploaded:0,folders:0};
  if(!ids.length)return {ok:true,uploaded:0,folders:0,errors:[]};
  const qs=ids.map(()=>'?').join(',');
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT v.version_id,v.gmail_message_id,v.filename_original,v.filename_normalized,v.mime_type,v.file_size,v.r2_key,v.received_at,
           COALESCE(NULLIF(g.airline,''),f.airline) AS airline,
           COALESCE(NULLIF(g.flight_number,''),f.flight_number) AS flight_number,
           COALESCE(NULLIF(g.flight_date,''),f.flight_date) AS flight_date
    FROM import_file_versions v
    JOIN import_files f ON f.file_id=v.file_id
    LEFT JOIN gmail_messages g ON g.gmail_message_id=v.gmail_message_id
    LEFT JOIN lot5_drive_files d ON d.version_id=v.version_id
    WHERE d.version_id IS NULL AND v.gmail_message_id IN (${qs})
    ORDER BY v.created_at ASC
  `).bind(...ids).all();
  let uploaded=0; const folders=new Set(); const errors=[];
  for(const row of results){
    try{
      const airline=String(row.airline||'').toUpperCase();
      const flightNumber=String(row.flight_number||'').toUpperCase();
      const flightDate=lot5CanonicalFlightDate(row.flight_date,row.received_at||'');
      const folder=await lot5EnsureFlightDriveFolder(env,{airline,flightNumber,flightDate,contextIso:row.received_at||''});
      folders.add(folder.identity);
      const file=await lot5UploadR2VersionToDrive(env,row,folder.flightFolderId);
      await env.OPS_DB.prepare(`INSERT INTO lot5_drive_files(version_id,identity,drive_file_id,drive_folder_id,filename,uploaded_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(version_id) DO NOTHING`).bind(String(row.version_id),folder.identity,file.id,folder.flightFolderId,file.name).run();
      uploaded++;
      if(row.gmail_message_id)await lot5SyncPrepaInboxForMessage(env,String(row.gmail_message_id),folder.flightFolderId).catch(()=>{});
    }catch(e){errors.push({versionId:String(row.version_id||''),error:String(e?.message||e)})}
  }
  return {ok:errors.length===0,uploaded,folders:folders.size,errors};
}

// R3: reconstruction ciblée d'un message déjà connu dont les versions techniques manquent.
// Le message est relu depuis Gmail ; le SHA-256 reste le seul critère de doublon contenu.
async function lot5ReplayMissingVersionsR3(env,messageId){
  const countRow=await env.OPS_DB.prepare(`SELECT COUNT(*) AS n FROM import_file_versions WHERE gmail_message_id=?`).bind(messageId).first().catch(()=>({n:0}));
  const before=Number(countRow?.n||0);
  if(before>0)return {messageId,replayed:false,before,after:before};
  const stored=await storeGmailMessage(env,messageId);
  await lot5RepairMessageIdentityV533(env,messageId).catch(()=>{});
  const afterRow=await env.OPS_DB.prepare(`SELECT COUNT(*) AS n FROM import_file_versions WHERE gmail_message_id=?`).bind(messageId).first().catch(()=>({n:0}));
  return {messageId,replayed:true,before,after:Number(afterRow?.n||0),stored};
}

async function lot5SpecificReadyForMessagesR3(env,messageIds){
  const ids=[...new Set((messageIds||[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!ids.length)return [];
  const qs=ids.map(()=>'?').join(',');
  return (await env.OPS_DB.prepare(`
    SELECT r.job_id,r.airline,r.flight_number,r.flight_date,r.status,r.parser_mode,r.card_key,r.list_name,
           j.gmail_message_id,j.version_id,v.r2_key,v.filename_original,v.mime_type
    FROM import_job_results r
    JOIN import_jobs j ON j.job_id=r.job_id
    LEFT JOIN import_file_versions v ON v.version_id=j.version_id
    WHERE j.gmail_message_id IN (${qs}) AND r.parser_mode='SPECIFIC_LOCKED' AND r.status='READY_SPECIFIC_PARSER'
    ORDER BY r.updated_at ASC
  `).bind(...ids).all()).results||[];
}

async function lot5TestBatchV535(env,body){
  await ensureLot5Tables(env);
  const ids=[...new Set((body?.messageIds||[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!ids.length)return {ok:false,error:'messageIds requis'};
  if(ids.length>20)return {ok:false,error:'Maximum 20 messages'};
  const stored=[]; const replay=[];
  for(const id of ids){
    try{stored.push(await storeGmailMessage(env,id));}
    catch(e){stored.push({messageId:id,status:'ERROR_IMPORT',error:String(e?.message||e)})}
    await lot5RepairMessageIdentityV533(env,id).catch(()=>{});
    try{replay.push(await lot5ReplayMissingVersionsR3(env,id));}catch(e){replay.push({messageId:id,error:String(e?.message||e)})}
  }
  const driveBefore=await lot5ArchiveDriveForMessagesV535(env,ids);
  const qs=ids.map(()=>'?').join(',');
  const jobs=(await env.OPS_DB.prepare(`SELECT * FROM import_jobs WHERE status='QUEUED' AND gmail_message_id IN (${qs}) ORDER BY priority ASC,created_at ASC`).bind(...ids).all()).results||[];
  const processed=[];
  for(const job of jobs){
    try{processed.push(await lot2ProcessOneJob(env,job));}
    catch(e){processed.push({job_id:job.job_id,error:String(e?.message||e)})}
  }
  const driveAfter=await lot5ArchiveDriveForMessagesV535(env,ids);
  const resultRows=(await env.OPS_DB.prepare(`SELECT r.* FROM import_job_results r JOIN import_jobs j ON j.job_id=r.job_id WHERE j.gmail_message_id IN (${qs}) ORDER BY r.updated_at ASC`).bind(...ids).all()).results||[];
  let injected=0,waiting=0; const injectionErrors=[];
  for(const row of resultRows){
    if(String(row.parser_mode||'')!=='GENERIC')continue;
    try{const r=await lot3InjectOneResult(env,row,{createMissingFlights:true}); if(r?.status==='INJECTED')injected++; else waiting++;}
    catch(e){injectionErrors.push({jobId:row.job_id,error:String(e?.message||e)})}
  }
  const audits=[];
  for(const id of ids){
    await lot5ReconcileOneGmailStateV53(env,id).catch(()=>{});
    await lot5SyncPrepaInboxForMessage(env,id).catch(()=>{});
    audits.push(await lot5AuditMessageV534(env,id).catch(e=>({messageId:id,error:String(e?.message||e)})));
  }
  const specificReady=await lot5SpecificReadyForMessagesR3(env,ids);
  return {ok:true,testMode:true,r3:true,messageCount:ids.length,stored,replay,processedJobs:processed.length,driveUploaded:Number(driveBefore.uploaded||0)+Number(driveAfter.uploaded||0),injected,waiting,specificReadyCount:specificReady.length,specificReady,injectionErrors,audits};
}

async function lot5ReconcileCanonicalStatusesR4(env,limit=2000){
  const result=await lot5ReconcileGmailStatesV53(env,Math.max(1,Math.min(2000,Number(limit||2000))));
  const rows=(await env.OPS_DB.prepare(`
    SELECT gmail_message_id FROM gmail_messages
    WHERE status<>'IGNORED_NON_OPERATIONAL'
    ORDER BY updated_at DESC LIMIT ?
  `).bind(Math.max(1,Math.min(2000,Number(limit||2000)))).all()).results||[];
  let synced=0;
  for(const r of rows){
    const id=String(r.gmail_message_id||''); if(!id)continue;
    try{await lot5SyncPrepaInboxForMessage(env,id);synced++}catch(e){}
  }
  return {ok:true,r4:true,reconciled:result.checked||0,counts:result.counts||{},syncCount:synced,errors:result.errors||[]};
}

async function handleLot5(request,env,url){
  if(!url.pathname.startsWith('/api/autopilot'))return null;
  try{
    if(url.pathname==='/api/autopilot/status'&&request.method==='GET')return json(await lot5Status(env));
    if(url.pathname==='/api/autopilot/test-batch'&&request.method==='POST'){ const body=await request.json().catch(()=>({})); return json(await lot5TestBatchV535(env,body)); }
    if(url.pathname==='/api/autopilot/run'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      return json(await lot5AutoPilotRun(env,{triggerType:'MANUAL',gmailQuery:String(body?.query||''),gmailMax:Number(body?.maxMessages||0)}));
    }
    if(url.pathname==='/api/autopilot/reconcile-canonical-status'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      return json(await lot5ReconcileCanonicalStatusesR4(env,Number(body?.limit||2000)));
    }
    if(url.pathname==='/api/autopilot/reconcile-labels'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      const result=await lot5ReconcileGmailStatesV53(env,Number(body?.limit||1500));
      const synced=await lot5SyncPrepaInboxRecent(env);
      return json({ok:result.ok,result,prepaSynced:synced});
    }
    if(url.pathname==='/api/autopilot/repair-identities'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      return json(await lot5RepairIdentityBacklogV534(env,Number(body?.limit||1200)));
    }
    if(url.pathname==='/api/autopilot/specific-browser-complete'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      return json(await lot5SpecificBrowserCompleteV535(env,body));
    }
    if(url.pathname==='/api/autopilot/audit'&&request.method==='GET'){
      const messageId=String(url.searchParams.get('messageId')||'').trim();
      if(messageId)return json(await lot5AuditMessageV534(env,messageId));
      return json(await lot5AuditBacklogV534(env,Number(url.searchParams.get('limit')||100)));
    }
    if(url.pathname==='/api/autopilot/stop'&&request.method==='POST'){
      const active=await env.OPS_DB.prepare(`SELECT run_id FROM lot5_autopilot_runs WHERE status='RUNNING' ORDER BY started_at DESC LIMIT 1`).first();
      await setIntegrationJson(env,'lot5_autopilot_stop_requested',{requested:true,runId:String(active?.run_id||''),requestedAt:new Date().toISOString()});
      return json({ok:true,requested:true,activeRunId:String(active?.run_id||''),message:'ARRÊT DEMANDÉ — prise en compte au prochain checkpoint'});
    }
    return json({ok:false,error:'ROUTE AUTO PILOT INCONNUE'},404);
  }catch(e){return json({ok:false,error:String(e?.message||e)},500)}
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
    if(url.pathname==="/api/import-pipeline/flight-cards" && request.method==="GET")return json(await lot3FlightCards(env,url));
    if(url.pathname==="/api/import-pipeline/inject-next" && request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      return json(await lot3InjectNext(env,body));
    }
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



async function lot5PrepaFastSummaryV535(env){
  await ensurePrepaControlTables(env);
  const rows=(await env.OPS_DB.prepare(`
    SELECT p.gmail_message_id,p.airline,p.flight_number,p.flight_date,p.status,p.attachments_json,p.received_at,p.updated_at,
           g.status AS gmail_status,g.received_at AS gmail_received_at,g.updated_at AS gmail_updated_at
    FROM prepa_inbox p
    LEFT JOIN gmail_messages g ON g.gmail_message_id=p.gmail_message_id
    WHERE p.source='GMAIL_AUTOPILOT'
    ORDER BY p.updated_at DESC
  `).all()).results||[];

  // R4 : toutes les variantes 03SEP / 02SEP26 / YYYYMMDD sont regroupées sous la date ISO.
  // Le statut d'une fiche n'est plus le "pire statut historique". Une ancienne ligne REVIEW
  // ne peut plus contaminer éternellement un vol qui a depuis été injecté/validé.
  const byFlight=new Map();
  let documents=0,unidentified=0;
  const stateClass=(st)=>{
    st=String(st||'').toUpperCase();
    if(st==='VALIDATED')return 'VALIDATED';
    if(st==='INJECTED')return 'INJECTED';
    if(st==='IMPORTED'||st==='PROCESSED')return 'IMPORTED';
    if(st==='RECEIVED'||st==='PENDING'||st==='PROCESSING')return 'RECEIVED';
    if(st==='DUPLICATE')return 'DUPLICATE';
    if(st==='ERROR_IMPORT'||st==='ERROR_INJECT'||st==='ERROR')return 'ERROR';
    if(st==='REVIEW'||st==='UNIDENTIFIED')return 'REVIEW';
    return st||'RECEIVED';
  };
  const ts=(r)=>String(r.gmail_updated_at||r.updated_at||r.gmail_received_at||r.received_at||'');

  for(const r of rows){
    let at=[]; try{at=JSON.parse(r.attachments_json||'[]')||[]}catch(e){}
    const n=Array.isArray(at)?at.length:0; documents+=n;
    const a=String(r.airline||'').toUpperCase();
    const f=String(r.flight_number||'').toUpperCase();
    const d=lot5CanonicalFlightDate(r.flight_date,r.received_at||r.gmail_received_at||'');
    if(!a||!f||!d){unidentified++;continue}
    const key=`${a}|${f}|${d}`;
    const rawState=String(r.gmail_status||r.status||'RECEIVED').toUpperCase();
    const st=stateClass(rawState);
    let cur=byFlight.get(key);
    if(!cur){
      cur={airline:a,flightNumber:f,flightDate:d,status:'RECEIVED',messages:0,documents:0,updatedAt:'',_states:[],_latestSuccess:'',_latestBlock:''};
      byFlight.set(key,cur);
    }
    cur.messages++; cur.documents+=n;
    const t=ts(r); if(t>cur.updatedAt)cur.updatedAt=t;
    cur._states.push({state:st,rawState,t,messageId:String(r.gmail_message_id||'')});
    if((st==='VALIDATED'||st==='INJECTED') && t>cur._latestSuccess)cur._latestSuccess=t;
    if((st==='ERROR'||st==='REVIEW') && t>cur._latestBlock)cur._latestBlock=t;
  }

  for(const cur of byFlight.values()){
    const states=cur._states.map(x=>x.state);
    const has=(x)=>states.includes(x);
    const allFinal=states.length>0 && states.every(x=>x==='VALIDATED'||x==='DUPLICATE');
    const blockingIsNewer=cur._latestBlock && (!cur._latestSuccess || cur._latestBlock>cur._latestSuccess);
    if(allFinal)cur.status='VALIDATED';
    else if(blockingIsNewer){
      const blockers=cur._states.filter(x=>x.state==='ERROR'||x.state==='REVIEW').sort((a,b)=>String(b.t).localeCompare(String(a.t)));
      cur.status=blockers[0]?.state==='ERROR'?'ERROR_IMPORT':'REVIEW';
    }else if(has('VALIDATED'))cur.status='VALIDATED';
    else if(has('INJECTED'))cur.status='INJECTED';
    else if(has('IMPORTED'))cur.status='IMPORTED';
    else if(has('RECEIVED'))cur.status='RECEIVED';
    else if(has('ERROR'))cur.status='ERROR_IMPORT';
    else if(has('REVIEW'))cur.status='REVIEW';
    else cur.status='RECEIVED';
    delete cur._states; delete cur._latestSuccess; delete cur._latestBlock;
  }

  const flights=[...byFlight.values()].sort((x,y)=>String(y.flightDate).localeCompare(String(x.flightDate))||String(x.airline).localeCompare(String(y.airline))||String(x.flightNumber).localeCompare(String(y.flightNumber)));
  const counters={received:0,imported:0,injected:0,validated:0,errors:0,review:0};
  const companies={};
  for(const f of flights){
    const st=f.status;
    if(st==='RECEIVED')counters.received++;
    else if(st==='IMPORTED')counters.imported++;
    else if(st==='INJECTED')counters.injected++;
    else if(st==='VALIDATED')counters.validated++;
    else if(st.startsWith('ERROR'))counters.errors++;
    else if(st==='REVIEW')counters.review++;
    const c=companies[f.airline]||(companies[f.airline]={airline:f.airline,flights:0,documents:0,received:0,imported:0,injected:0,validated:0,errors:0,review:0});
    c.flights++; c.documents+=f.documents;
    if(st==='RECEIVED')c.received++;
    else if(st==='IMPORTED')c.imported++;
    else if(st==='INJECTED')c.injected++;
    else if(st==='VALIDATED')c.validated++;
    else if(st.startsWith('ERROR'))c.errors++;
    else if(st==='REVIEW')c.review++;
  }
  return {ok:true,r4:true,documents,flightCount:flights.length,unidentified,counters,companies:Object.values(companies).sort((a,b)=>a.airline.localeCompare(b.airline)),flights};
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
  if (url.pathname === "/api/prepa/summary" && request.method === "GET") {
    return json(await lot5PrepaFastSummaryV535(env));
  }

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

      if(url.pathname.startsWith("/api/autopilot")){
        const result=await handleLot5(request,env,url);
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
  },

  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      const result=await lot5AutoPilotRun(env,{triggerType:"CRON"});
      if(!result?.ok)console.error("ALYZIA LOT5 AUTO PILOT",result?.error||result);
    })());
  }
};
