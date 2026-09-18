import app from "./index.js";

/*
 * V50.32 — Correctif d'affichage des durées.
 *
 * Le calcul interne peut encore produire un résidu flottant dans certaines
 * chaînes déjà formatées (ex. 12:10.00013333). En plus d'arrondir les valeurs
 * numériques connues, on normalise le texte réellement rendu dans le DOM et
 * on observe les futurs rerendus de l'application.
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

    const normalizeDurationText = value => String(value || '').replace(
      /(^|[^0-9])(\d{1,3}):([0-5]\d)\.\d+(?=$|[^0-9])/g,
      '$1$2:$3'
    );

    const normalizeTextNode = node => {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const parent = node.parentElement;
      if (parent && /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/i.test(parent.tagName)) return;
      const current = node.nodeValue || '';
      const next = normalizeDurationText(current);
      if (next !== current) node.nodeValue = next;
    };

    const normalizeTree = root => {
      if (!root) return;
      if (root.nodeType === Node.TEXT_NODE) {
        normalizeTextNode(root);
        return;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) normalizeTextNode(node);
    };

    const runNormalize = () => normalizeTree(document.body);

    if (document.body) runNormalize();
    else document.addEventListener('DOMContentLoaded', runNormalize, { once: true });

    const startObserver = () => {
      if (!document.body) return;
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') normalizeTextNode(mutation.target);
          for (const node of mutation.addedNodes || []) normalizeTree(node);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    };

    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

    if (typeof render === 'function') render();
    queueMicrotask(runNormalize);
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
