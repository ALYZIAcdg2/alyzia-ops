// ALYZIA OPS V49.11 · Worker complet
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

async function getFlights(env){
  const {results=[]}=await env.OPS_DB
    .prepare(`SELECT data_json, updated_at
              FROM flights
              ORDER BY flight_date, std, flight_number`)
    .all();

  const flights=[];
  for(const row of results){
    try{
      const x=JSON.parse(row.data_json);
      x._serverUpdatedAt=row.updated_at||"";
      if(validFlight(x))flights.push(x);
    }catch(e){}
  }
  return flights;
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

    const flights=await getFlights(env);
    return json({ok:true,count:flights.length,flights});
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

  const gmailMessageId =
    String(gmail.messageId || "").trim();

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

  if (
    !gmailMessageId ||
    !airline ||
    !flightNumber ||
    !flightDate
  ) {
    return null;
  }

  if (!["TK", "SQ", "BJ"].includes(airline)) {
    return null;
  }

  return {
    gmailMessageId,

    gmailThreadId:
      String(gmail.threadId || "").trim(),

    airline,
    flightNumber,
    flightDate,

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

    attachments:
      Array.isArray(body.attachments)
        ? body.attachments
        : []
  };
}


async function savePrepaInbox(env, item) {

  const attachmentsJson =
    JSON.stringify(item.attachments || []);

  await env.OPS_DB.prepare(`
    INSERT INTO prepa_inbox (
      gmail_message_id,
      gmail_thread_id,

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
      updated_at
    )

    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING',
      CURRENT_TIMESTAMP
    )

    ON CONFLICT(gmail_message_id)
    DO UPDATE SET

      gmail_thread_id=excluded.gmail_thread_id,

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

      updated_at=CURRENT_TIMESTAMP
  `).bind(
    item.gmailMessageId,
    item.gmailThreadId,

    item.airline,
    item.flightNumber,
    item.flightDate,

    item.subject,
    item.sender,
    item.receivedAt,

    item.bodyText,

    item.driveFolderId,
    item.driveEmailPdfId,

    attachmentsJson
  ).run();
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


  let sql = `
    SELECT
      id,
      gmail_message_id,
      gmail_thread_id,

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
    LIMIT 200
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
        attachments =
          JSON.parse(
            row.attachments_json || "[]"
          );
      } catch (e) {}


      return {
        id: row.id,

        gmailMessageId:
          row.gmail_message_id,

        gmailThreadId:
          row.gmail_thread_id,

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

      status: "PENDING"
    });
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
      console.error("ALYZIA OPS V49.11",err);
      return json({
        ok:false,
        error:err?.message||String(err)
      },500);
    }
  }
};
