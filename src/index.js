// ALYZIA OPS V47 · Worker complet
// - Assets statiques public/
// - API vols partagée D1
// - Bridge interne vers SARIA

const SARIA_PUBLIC_ORIGIN =
  "https://saria-seatmap.alyzia-cdg2.workers.dev";

function json(
  data,
  status = 200,
  extraHeaders = {}
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,POST,PUT,DELETE,OPTIONS",

        "Access-Control-Allow-Headers":
          "Content-Type",

        "Cache-Control":
          "no-store",

        ...extraHeaders
      }
    }
  );
}


function flightIdentity(x) {
  return [
    String(
      x?.date || ""
    ).trim(),

    String(
      x?.airline || ""
    )
      .trim()
      .toUpperCase(),

    String(
      x?.flight || ""
    )
      .trim()
      .toUpperCase()

  ].join("|");
}


function validFlight(x) {
  return (
    x &&

    String(
      x.date || ""
    ).trim() &&

    String(
      x.airline || ""
    ).trim() &&

    String(
      x.flight || ""
    ).trim() &&

    String(
      x.airline || ""
    )
      .trim()
      .toUpperCase() !== "KL"
  );
}


/* =========================================
   LECTURE DE TOUS LES VOLS
   ========================================= */

async function getFlights(env) {

  const {
    results = []
  } =
    await env.OPS_DB
      .prepare(
        `
        SELECT data_json
        FROM flights
        ORDER BY
          flight_date,
          std,
          flight_number
        `
      )
      .all();

  const flights = [];

  for (
    const row of results
  ) {

    try {

      const x =
        JSON.parse(
          row.data_json
        );

      if (
        validFlight(x)
      ) {
        flights.push(x);
      }

    } catch (e) {}

  }

  return flights;
}


/* =========================================
   AJOUT / MODIFICATION D'UN VOL
   ========================================= */

async function upsertFlight(
  env,
  x
) {

  if (
    !validFlight(x)
  ) {
    return false;
  }

  const identity =
    flightIdentity(x);

  await env.OPS_DB
    .prepare(
      `
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

      VALUES
      (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(identity)
      DO UPDATE SET

        flight_date =
          excluded.flight_date,

        airline =
          excluded.airline,

        flight_number =
          excluded.flight_number,

        std =
          excluded.std,

        data_json =
          excluded.data_json,

        updated_at =
          CURRENT_TIMESTAMP
      `
    )
    .bind(

      identity,

      String(
        x.date || ""
      ),

      String(
        x.airline || ""
      ).toUpperCase(),

      String(
        x.flight || ""
      ).toUpperCase(),

      String(
        x.std || ""
      ),

      JSON.stringify(x)

    )
    .run();

  return true;
}


/* =========================================
   SYNCHRONISATION D'UNE LISTE DE VOLS
   ========================================= */

async function syncFlights(
  env,
  flights
) {

  const clean = [];
  const seen =
    new Set();


  for (
    const x of
      Array.isArray(flights)
        ? flights
        : []
  ) {

    if (
      !validFlight(x)
    ) {
      continue;
    }


    const id =
      flightIdentity(x);


    if (
      seen.has(id)
    ) {
      continue;
    }


    seen.add(id);
    clean.push(x);
  }


  /*
    Batch par blocs
    pour gérer un import
    mensuel important.
  */

  const CHUNK = 40;


  for (
    let i = 0;
    i < clean.length;
    i += CHUNK
  ) {

    const statements =
      clean
        .slice(
          i,
          i + CHUNK
        )
        .map(
          x =>
            env.OPS_DB
              .prepare(
                `
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

                VALUES
                (
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  CURRENT_TIMESTAMP
                )

                ON CONFLICT(identity)
                DO UPDATE SET

                  flight_date =
                    excluded.flight_date,

                  airline =
                    excluded.airline,

                  flight_number =
                    excluded.flight_number,

                  std =
                    excluded.std,

                  data_json =
                    excluded.data_json,

                  updated_at =
                    CURRENT_TIMESTAMP
                `
              )
              .bind(

                flightIdentity(x),

                String(
                  x.date || ""
                ),

                String(
                  x.airline || ""
                ).toUpperCase(),

                String(
                  x.flight || ""
                ).toUpperCase(),

                String(
                  x.std || ""
                ),

                JSON.stringify(x)
              )
        );


    if (
      statements.length
    ) {

      await env.OPS_DB
        .batch(
          statements
        );

    }

  }


  return clean.length;
}


/* =========================================
   API VOLS
   ========================================= */

async function handleFlights(
  request,
  env,
  url
) {

  if (
    request.method ===
      "OPTIONS"
  ) {

    return json({
      ok: true
    });

  }


  /*
    GET
    /api/flights
  */

  if (
    url.pathname ===
      "/api/flights" &&

    request.method ===
      "GET"
  ) {

    const flights =
      await getFlights(env);


    return json({

      ok: true,

      count:
        flights.length,

      flights

    });

  }


  /*
    POST
    /api/flights

    Ajoute ou modifie
    un seul vol.
  */

  if (
    url.pathname ===
      "/api/flights" &&

    request.method ===
      "POST"
  ) {

    const body =
      await request
        .json()
        .catch(
          () => null
        );


    if (
      !validFlight(
        body?.flight
      )
    ) {

      return json(
        {
          ok: false,
          error:
            "VOL INVALIDE"
        },
        400
      );

    }


    await upsertFlight(
      env,
      body.flight
    );


    return json({

      ok: true,

      identity:
        flightIdentity(
          body.flight
        )

    });

  }


  /*
    POST
    /api/flights/sync

    Synchronisation
    d'une liste complète.
  */

  if (
    url.pathname ===
      "/api/flights/sync" &&

    request.method ===
      "POST"
  ) {

    const body =
      await request
        .json()
        .catch(
          () => null
        );


    if (
      !Array.isArray(
        body?.flights
      )
    ) {

      return json(
        {
          ok: false,
          error:
            "LISTE VOLS MANQUANTE"
        },
        400
      );

    }


    const count =
      await syncFlights(
        env,
        body.flights
      );


    return json({

      ok: true,

      count

    });

  }


  /*
    DELETE
    /api/flights

    Remise à zéro
    de la base vols.
  */

  if (
    url.pathname ===
      "/api/flights" &&

    request.method ===
      "DELETE"
  ) {

    await env.OPS_DB
      .prepare(
        "DELETE FROM flights"
      )
      .run();


    return json({

      ok: true,

      cleared: true

    });

  }


  return null;
}


/* =========================================
   BRIDGE ALYZIA -> SARIA
   ========================================= */

async function handleSariaBridge(
  request,
  env,
  url
) {

  if (
    !url.pathname
      .startsWith(
        "/api/saria/"
      )
  ) {

    return null;

  }


  const subpath =
    url.pathname.replace(
      /^\/api\/saria/,
      "/api"
    );


  const headers =
    new Headers(
      request.headers
    );


  headers.delete(
    "host"
  );


  let response;


  /*
    SERVICE BINDING
    Cloudflare interne
  */

  if (
    env.SARIA &&
    typeof env.SARIA.fetch ===
      "function"
  ) {

    const internal =
      new URL(
        request.url
      );


    internal.protocol =
      "https:";

    internal.hostname =
      "saria.internal";

    internal.pathname =
      subpath;


    response =
      await env.SARIA.fetch(

        new Request(
          internal.toString(),
          {

            method:
              request.method,

            headers,

            body:
              [
                "GET",
                "HEAD"
              ].includes(
                request.method
              )
                ? undefined
                : request.body

          }
        )

      );

  } else {

    /*
      Fallback URL publique
      si le Service Binding
      n'est pas disponible.
    */

    const target =
      new URL(

        subpath +
          url.search,

        SARIA_PUBLIC_ORIGIN

      );


    response =
      await fetch(
        target.toString(),
        {

          method:
            request.method,

          headers,

          body:
            [
              "GET",
              "HEAD"
            ].includes(
              request.method
            )
              ? undefined
              : request.body

        }
      );

  }


  const outHeaders =
    new Headers(
      response.headers
    );


  outHeaders.set(
    "Access-Control-Allow-Origin",
    "*"
  );


  outHeaders.set(
    "X-ALYZIA-SARIA-BRIDGE",
    env.SARIA
      ? "SERVICE-BINDING"
      : "PUBLIC-FALLBACK"
  );


  /*
    Cache SARIA
  */

  if (
    request.method ===
      "GET"
  ) {

    outHeaders.set(

      "Cache-Control",

      subpath.includes(
        "/layout"
      )
        ? "public, max-age=3600"
        : "public, max-age=300"

    );

  }


  return new Response(
    response.body,
    {

      status:
        response.status,

      statusText:
        response.statusText,

      headers:
        outHeaders

    }
  );
}


/* =========================================
   WORKER PRINCIPAL
   ========================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );


    try {

      /*
        CORS
      */

      if (
        request.method ===
          "OPTIONS"
      ) {

        return json({
          ok: true
        });

      }


      /*
        API VOLS
      */

      if (
        url.pathname
          .startsWith(
            "/api/flights"
          )
      ) {

        const result =
          await handleFlights(
            request,
            env,
            url
          );


        if (
          result
        ) {

          return result;

        }

      }


      /*
        API SARIA
      */

      if (
        url.pathname
          .startsWith(
            "/api/saria/"
          )
      ) {

        const result =
          await handleSariaBridge(
            request,
            env,
            url
          );


        if (
          result
        ) {

          return result;

        }

      }


      /*
        FICHIERS STATIQUES
        public/index.html
      */

      return env.ASSETS.fetch(
        request
      );


    } catch (err) {

      console.error(
        "ALYZIA OPS V47",
        err
      );


      return json(
        {

          ok: false,

          error:
            err?.message ||
            String(err)

        },
        500
      );

    }

  }

};
