// ALYZIA OPS V50.1 · Worker GENERIC + airline profiles + Notes/R2
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
    if(isPlainObject(v) && isPlainObject(out[k])){
      out[k]=deepMerge(out[k],v);
    }else{
      out[k]=v;
    }
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

  const CHUNK=40;

  for(let i=0;i<clean.length;i+=CHUNK){
    const statements=clean
      .slice(i,i+CHUNK)
      .map(x=>
        env.OPS_DB.prepare(`
          INSERT INTO flights
            (
              identity,
              flight_date,
              airline,
              flight_number,
              std,
              data_json,
              updated_at
            )
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

    if(statements.length){
      await env.OPS_DB.batch(statements);
    }
  }

  return clean.length;
}

async function handleFlights(request,env,url){
  if(request.method==="OPTIONS"){
    return json({ok:true});
  }

  if(
    url.pathname==="/api/flights" &&
    request.method==="GET"
  ){
    const identity=String(
      url.searchParams.get("identity")||""
    ).trim();

    if(identity){
      const flight=await getFlightByIdentity(
        env,
        identity
      );

      if(!flight){
        return json({
          ok:false,
          error:"VOL INTROUVABLE"
        },404);
      }

      return json({
        ok:true,
        flight
      });
    }

    return await getFlightsResponse(env);
  }


  if(
    url.pathname==="/api/flights" &&
    request.method==="POST"
  ){
    const body=await request
      .json()
      .catch(()=>null);

    if(!validFlight(body?.flight)){
      return json({
        ok:false,
        error:"VOL INVALIDE"
      },400);
    }

    await upsertFlight(
      env,
      body.flight
    );

    const identity=
      flightIdentity(body.flight);

    const flight=
      await getFlightByIdentity(
        env,
        identity
      );

    return json({
      ok:true,
      identity,
      flight
    });
  }


  if(
    url.pathname==="/api/flights" &&
    request.method==="PATCH"
  ){
    const body=await request
      .json()
      .catch(()=>null);

    const identity=
      String(body?.identity||"").trim();

    const patch=
      body?.patch;

    if(
      !identity ||
      !patch ||
      typeof patch!=="object"
    ){
      return json({
        ok:false,
        error:"IDENTITY OU PATCH MANQUANT"
      },400);
    }

    const flight=
      await patchFlight(
        env,
        identity,
        patch
      );

    if(!flight){
      return json({
        ok:false,
        error:"VOL INTROUVABLE"
      },404);
    }

    return json({
      ok:true,
      identity,
      flight
    });
  }


  if(
    url.pathname==="/api/flights/sync" &&
    request.method==="POST"
  ){
    const body=await request
      .json()
      .catch(()=>null);

    if(!Array.isArray(body?.flights)){
      return json({
        ok:false,
        error:"LISTE VOLS MANQUANTE"
      },400);
    }

    const count=
      await syncFlights(
        env,
        body.flights
      );

    return json({
      ok:true,
      count
    });
  }


  if(
    url.pathname==="/api/flights" &&
    request.method==="DELETE"
  ){
    await env.OPS_DB.prepare(
      "DELETE FROM flights"
    ).run();

    return json({
      ok:true,
      cleared:true
    });
  }

  return null;
}


function isAuthorizedPrepa(request,env){
  const expected=String(
    env.ALYZIA_API_SECRET||""
  ).trim();

  if(!expected){
    return false;
  }

  const auth=String(
    request.headers.get("Authorization")||""
  ).trim();

  if(!auth.startsWith("Bearer ")){
    return false;
  }

  const supplied=
    auth.slice(7).trim();

  return supplied===expected;
}


function normalizePrepaPayload(body){
  if(
    !body ||
    typeof body!=="object"
  ){
    return null;
  }

  const gmail=
    body.gmail||{};

  const flight=
    body.flight||{};

  const email=
    body.email||{};

  const drive=
    body.drive||{};

  const detection=
    body.detection||{};


  const gmailMessageId=
    String(
      gmail.messageId||""
    ).trim();

  if(!gmailMessageId){
    return null;
  }


  const source=
    String(
      body.source||"GMAIL"
    )
      .trim()
      .toUpperCase();


  const airline=
    String(
      flight.airline||""
    )
      .trim()
      .toUpperCase();


  const flightNumber=
    String(
      flight.flightNumber||""
    )
      .trim()
      .toUpperCase();


  const flightDate=
    String(
      flight.date||""
    ).trim();


  const detectionStatus=
    String(
      detection.status||""
    )
      .trim()
      .toUpperCase();


  const attachments=
    Array.isArray(body.attachments)
      ? body.attachments
      : [];


  /*
   * IMPORT IDENTIFIÉ V50
   *
   * Toute compagnie est acceptée
   * dès lors que nous avons :
   *
   * compagnie
   * numéro de vol
   * date
   *
   * Le profil déterminera ensuite
   * GENERIC ou SPECIFIC.
   */
  const identified=
    !!airline &&
    !!flightNumber &&
    !!flightDate;


  /*
   * IMPORT NON IDENTIFIÉ
   */
  const unidentified=
    !identified &&
    (
      detectionStatus==="UNIDENTIFIED" ||
      source==="GMAIL_UNIDENTIFIED"
    ) &&
    attachments.length>0;


  if(
    !identified &&
    !unidentified
  ){
    return null;
  }


  return {
    gmailMessageId,

    gmailThreadId:
      String(
        gmail.threadId||""
      ).trim(),

    source:
      source||"GMAIL",

    detectionStatus:
      identified
        ? "IDENTIFIED"
        : "UNIDENTIFIED",

    airline:
      identified
        ? airline
        : "",

    flightNumber:
      identified
        ? flightNumber
        : "",

    flightDate:
      identified
        ? flightDate
        : "",

    subject:
      String(
        gmail.subject||""
      ),

    sender:
      String(
        gmail.from||""
      ),

    receivedAt:
      String(
        gmail.receivedAt||""
      ),

    bodyText:
      String(
        email.plainText||""
      ),

    driveFolderId:
      String(
        drive.folderId||""
      ),

    driveEmailPdfId:
      String(
        drive.emailPdfId||""
      ),

    attachments
  };
}


/* =========================================================
   PROFILS COMPAGNIES V50
   ========================================================= */

function defaultImportModeForAirline(airline){
  const code=String(
    airline||""
  )
    .trim()
    .toUpperCase();

  return [
    "SQ",
    "TK",
    "BJ"
  ].includes(code)
    ? "SPECIFIC"
    : "GENERIC";
}


async function ensureAirlineProfile(
  env,
  airline
){
  const code=String(
    airline||""
  )
    .trim()
    .toUpperCase();

  if(!code){
    return null;
  }


  const mode=
    defaultImportModeForAirline(code);


  await env.OPS_DB.prepare(`
    INSERT OR IGNORE INTO airline_profiles
      (
        airline,
        import_mode,
        visible_kpis_json,
        visible_cards_json,
        notes_enabled,
        attachments_enabled,
        updated_at
      )

    VALUES (
      ?,
      ?,
      '{}',
      '{}',
      1,
      1,
      CURRENT_TIMESTAMP
    )
  `)
  .bind(
    code,
    mode
  )
  .run();


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
  `)
  .bind(code)
  .first();
}


function safeJsonParse(
  value,
  fallback
){
  try{
    return JSON.parse(
      String(value??"")
    );
  }catch(e){
    return fallback;
  }
}


async function getAirlineProfiles(env){
  const {
    results=[]
  }=await env.OPS_DB.prepare(`
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
    airline:
      String(
        row.airline||""
      ).toUpperCase(),

    importMode:
      String(
        row.import_mode||
        "GENERIC"
      ).toUpperCase(),

    visibleKpis:
      safeJsonParse(
        row.visible_kpis_json,
        {}
      ),

    visibleCards:
      safeJsonParse(
        row.visible_cards_json,
        {}
      ),

    notesEnabled:
      Number(
        row.notes_enabled
      )!==0,

    attachmentsEnabled:
      Number(
        row.attachments_enabled
      )!==0,

    updatedAt:
      row.updated_at||""
  }));
}


async function handleAirlineProfiles(
  request,
  env,
  url
){
  if(
    !url.pathname.startsWith(
      "/api/airline-profiles"
    )
  ){
    return null;
  }


  if(request.method==="OPTIONS"){
    return json({ok:true});
  }


  /*
   * LECTURE PROFILS
   */
  if(
    url.pathname==="/api/airline-profiles" &&
    request.method==="GET"
  ){
    const airline=String(
      url.searchParams.get("airline")||""
    )
      .trim()
      .toUpperCase();


    if(airline){
      const row=
        await ensureAirlineProfile(
          env,
          airline
        );


      if(!row){
        return json({
          ok:false,
          error:"COMPAGNIE INVALIDE"
        },400);
      }


      return json({
        ok:true,

        profile:{
          airline:
            String(
              row.airline||""
            ).toUpperCase(),

          importMode:
            String(
              row.import_mode||
              "GENERIC"
            ).toUpperCase(),

          visibleKpis:
            safeJsonParse(
              row.visible_kpis_json,
              {}
            ),

          visibleCards:
            safeJsonParse(
              row.visible_cards_json,
              {}
            ),

          notesEnabled:
            Number(
              row.notes_enabled
            )!==0,

          attachmentsEnabled:
            Number(
              row.attachments_enabled
            )!==0,

          updatedAt:
            row.updated_at||""
        }
      });
    }


    const profiles=
      await getAirlineProfiles(env);


    return json({
      ok:true,
      count:profiles.length,
      profiles
    });
  }


  /*
   * MODIFICATION PROFIL
   *
   * Protection temporaire par
   * ALYZIA_API_SECRET.
   *
   * Les rôles utilisateurs arriveront
   * à l'étape AUTH.
   */
  if(
    url.pathname==="/api/airline-profiles" &&
    request.method==="PATCH"
  ){
    if(
      !isAuthorizedPrepa(
        request,
        env
      )
    ){
      return json({
        ok:false,
        error:"NON AUTORISE"
      },401);
    }


    const body=
      await request
        .json()
        .catch(()=>null);


    const airline=
      String(
        body?.airline||""
      )
        .trim()
        .toUpperCase();


    if(!airline){
      return json({
        ok:false,
        error:"COMPAGNIE MANQUANTE"
      },400);
    }


    await ensureAirlineProfile(
      env,
      airline
    );


    const sets=[];
    const binds=[];


    if(
      body?.importMode!==undefined
    ){
      const mode=
        String(
          body.importMode||""
        )
          .trim()
          .toUpperCase();


      if(
        ![
          "GENERIC",
          "SPECIFIC"
        ].includes(mode)
      ){
        return json({
          ok:false,
          error:"MODE IMPORT INVALIDE"
        },400);
      }


      sets.push(
        "import_mode=?"
      );

      binds.push(mode);
    }


    if(
      body?.visibleKpis!==undefined
    ){
      sets.push(
        "visible_kpis_json=?"
      );

      binds.push(
        JSON.stringify(
          body.visibleKpis||{}
        )
      );
    }


    if(
      body?.visibleCards!==undefined
    ){
      sets.push(
        "visible_cards_json=?"
      );

      binds.push(
        JSON.stringify(
          body.visibleCards||{}
        )
      );
    }


    if(
      body?.notesEnabled!==undefined
    ){
      sets.push(
        "notes_enabled=?"
      );

      binds.push(
        body.notesEnabled
          ? 1
          : 0
      );
    }


    if(
      body?.attachmentsEnabled!==undefined
    ){
      sets.push(
        "attachments_enabled=?"
      );

      binds.push(
        body.attachmentsEnabled
          ? 1
          : 0
      );
    }


    if(!sets.length){
      return json({
        ok:false,
        error:"AUCUNE MODIFICATION"
      },400);
    }


    sets.push(
      "updated_at=CURRENT_TIMESTAMP"
    );

    binds.push(airline);


    await env.OPS_DB.prepare(`
      UPDATE airline_profiles

      SET ${sets.join(", ")}

      WHERE airline=?
    `)
    .bind(...binds)
    .run();


    const row=
      await ensureAirlineProfile(
        env,
        airline
      );


    return json({
      ok:true,

      profile:{
        airline:
          String(
            row.airline||""
          ).toUpperCase(),

        importMode:
          String(
            row.import_mode||
            "GENERIC"
          ).toUpperCase(),

        visibleKpis:
          safeJsonParse(
            row.visible_kpis_json,
            {}
          ),

        visibleCards:
          safeJsonParse(
            row.visible_cards_json,
            {}
          ),

        notesEnabled:
          Number(
            row.notes_enabled
          )!==0,

        attachmentsEnabled:
          Number(
            row.attachments_enabled
          )!==0,

        updatedAt:
          row.updated_at||""
      }
    });
  }


  return json({
    ok:false,
    error:"ROUTE PROFIL COMPAGNIE INTROUVABLE"
  },404);
}
