// Porté verbatim depuis src/index.js v1 (handleSariaBridge) — proxy
// transparent vers le service SARIA (seatmap), via le binding de service
// Cloudflare quand il est présent, sinon vers l'origine publique.

const SARIA_PUBLIC_ORIGIN = "https://saria-seatmap.alyzia-cdg2.workers.dev";

export async function handleSariaBridge(request, env, url) {
  if (!url.pathname.startsWith("/api/saria/")) return null;

  const subpath = url.pathname.replace(/^\/api\/saria/, "/api");
  const headers = new Headers(request.headers);
  headers.delete("host");

  let response;

  if (env.SARIA && typeof env.SARIA.fetch === "function") {
    const internal = new URL(request.url);
    internal.protocol = "https:";
    internal.hostname = "saria.internal";
    internal.pathname = subpath;

    response = await env.SARIA.fetch(
      new Request(internal.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      }),
    );
  } else {
    const target = new URL(subpath + url.search, SARIA_PUBLIC_ORIGIN);
    response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    });
  }

  const outHeaders = new Headers(response.headers);
  outHeaders.set("Access-Control-Allow-Origin", "*");
  outHeaders.set("X-ALYZIA-SARIA-BRIDGE", env.SARIA ? "SERVICE-BINDING" : "PUBLIC-FALLBACK");

  if (request.method === "GET") {
    outHeaders.set("Cache-Control", subpath.includes("/layout") ? "public, max-age=3600" : "public, max-age=300");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outHeaders,
  });
}
