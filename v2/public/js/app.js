// Point d'entrée de l'application — pas de framework, pas de build : ce
// module est chargé directement par le navigateur (<script type="module">).
// Deux écrans seulement pour l'instant : la liste des vols et le tableau
// de bord d'un vol (voir render-flight-list.js / render-flight-card.js).

import { renderFlightList } from "./render-flight-list.js";
import { renderFlightCard } from "./render-flight-card.js";

const root = document.getElementById("app");

async function fetchJson(path) {
  const resp = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function renderError(message) {
  root.innerHTML = `<div class="error-note">Impossible de charger les données : ${message}</div>`;
}

function renderLoading() {
  root.innerHTML = `<div class="loading-note">Chargement…</div>`;
}

async function showFlightList() {
  renderLoading();
  try {
    const data = await fetchJson("/api/flights");
    root.innerHTML = `<h1 class="app-title">Vols</h1>${renderFlightList(data.flights)}`;
    root.querySelectorAll(".flight-row").forEach((row) => {
      const open = () => {
        const identity = row.getAttribute("data-identity");
        if (identity) location.hash = `#/flight/${encodeURIComponent(identity)}`;
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  } catch (e) {
    renderError(e.message);
  }
}

async function showFlight(identity) {
  renderLoading();
  try {
    const data = await fetchJson(`/api/flights?identity=${encodeURIComponent(identity)}`);
    root.innerHTML = `<a class="back-link" href="#/">← Retour aux vols</a>${renderFlightCard(data.flight)}`;
  } catch (e) {
    renderError(e.message);
  }
}

function route() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/flight\/(.+)$/);
  if (m) {
    showFlight(decodeURIComponent(m[1]));
  } else {
    showFlightList();
  }
}

window.addEventListener("hashchange", route);
route();
