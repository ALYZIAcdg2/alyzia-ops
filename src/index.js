export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // PONT ALYZIA OPS -> SARIA
    // ==========================================
    if (url.pathname.startsWith("/api/saria/")) {

      const sariaPath =
        url.pathname.replace(
          "/api/saria/",
          "/api/"
        );

      const targetUrl =
        new URL(
          sariaPath + url.search,
          "https://saria.internal"
        );

      const sariaRequest =
        new Request(
          targetUrl.toString(),
          {
            method: request.method,
            headers: request.headers,
            body:
              request.method === "GET" ||
              request.method === "HEAD"
                ? undefined
                : request.body
          }
        );

      const response =
        await env.SARIA.fetch(
          sariaRequest
        );

      const headers =
        new Headers(
          response.headers
        );

      headers.set(
        "Access-Control-Allow-Origin",
        "*"
      );

      headers.set(
        "X-ALYZIA-SARIA-BRIDGE",
        "SERVICE-BINDING"
      );

      // Cache des configurations
      if (
        url.pathname.includes(
          "/configurations"
        )
      ) {
        headers.set(
          "Cache-Control",
          "public, max-age=300"
        );
      }

      // Cache des seatmaps
      if (
        url.pathname.includes(
          "/layout"
        )
      ) {
        headers.set(
          "Cache-Control",
          "public, max-age=3600"
        );
      }

      return new Response(
        response.body,
        {
          status: response.status,
          statusText:
            response.statusText,
          headers
        }
      );
    }

    // ==========================================
    // SITE ALYZIA OPS
    // ==========================================

    return env.ASSETS.fetch(
      request
    );
  }
};
