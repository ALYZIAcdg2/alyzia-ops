import app from "./index.js";

/*
 * V50.33 — Correctif source du format de durée.
 *
 * public/index.html formatait directement `n % 60`. Quand `duration` contient
 * un résidu flottant (ex. 114.98915), l'interface affiche 1:54.98915 au lieu
 * de la minute opérationnelle attendue 1:55.
 *
 * Le Worker corrige la fonction `durationText` dans le HTML servi avant que
 * le navigateur ne l'exécute. Le nombre total de minutes est arrondi d'abord,
 * puis seulement converti en H:MM. Cela ne dépend pas d'un script ajouté au DOM.
 */
const OLD_DURATION_TEXT =
  "function durationText(m){const n=Number(m);return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";

const NEW_DURATION_TEXT =
  "function durationText(m){const n=Math.round(Number(m));return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";

export function patchDurationFormatter(html) {
  const source = String(html || "");
  return source.includes(OLD_DURATION_TEXT)
    ? source.replaceAll(OLD_DURATION_TEXT, NEW_DURATION_TEXT)
    : source;
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (!contentType.includes("text/html")) return response;

    const html = await response.text();
    const patched = patchDurationFormatter(html);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");

    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  },

  scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};
