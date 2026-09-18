import app from "./index.js";

/*
 * V50.31 — Correctif d'affichage des durées.
 *
 * Le calcul des décalages horaires IANA passe par Intl.DateTimeFormat, qui
 * restitue les secondes mais pas les millisecondes de Date. La soustraction
 * avec date.getTime() peut donc produire un très petit résidu flottant
 * (ex. 12:10.00013333 au lieu de 12:10).
 *
 * On arrondit le décalage à la minute — granularité suffisante pour les
 * fuseaux IANA utilisés — puis on normalise aussi les anciennes durées déjà
 * présentes en mémoire avant de relancer le rendu.
 */
const DURATION_FIX_SCRIPT = `
<script>
(() => {
  try {
    const originalAirportTzOffsetHours = globalThis.airportTzOffsetHours;
    if (typeof originalAirportTzOffsetHours === 'function') {
      globalThis.airportTzOffsetHours = function(iata, date) {
        const value = originalAirportTzOffsetHours(iata, date);
        return Number.isFinite(value) ? Math.round(value * 60) / 60 : value;
      };
    }

    const roundExistingMinutes = (flight, key) => {
      const raw = flight?.[key];
      if (raw === '' || raw === null || raw === undefined) return;
      const value = Number(raw);
      if (Number.isFinite(value)) flight[key] = Math.round(value);
    };

    try {
      if (typeof FLIGHTS !== 'undefined' && Array.isArray(FLIGHTS)) {
        for (const flight of FLIGHTS) {
          roundExistingMinutes(flight, 'duration');
          roundExistingMinutes(flight, 'durationMinutes');
        }
      }
    } catch (_) {}

    if (typeof render === 'function') render();
  } catch (_) {}
})();
</script>`;

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (!contentType.includes("text/html")) return response;

    return new HTMLRewriter()
      .on("body", {
        element(element) {
          element.append(DURATION_FIX_SCRIPT, { html: true });
        }
      })
      .transform(response);
  },

  scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};
