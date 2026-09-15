// Rendu du tableau de bord d'un vol — écran d'accueil de la nouvelle
// application, inspiré de la vision "MARCO" partagée par l'utilisateur :
// effectifs réservés/enregistrés par classe, catégories opérationnelles
// (PMR/UM/enfants/bébés...), correspondances, en un coup d'œil.
//
// Fonction pure (objet vol → chaîne HTML) pour rester testable sans DOM ni
// serveur — voir v2/tests/render-flight-card.test.js.

import { escapeHtml, formatDateFr, formatTime, sum } from "./format.js";
import { COMMON_LABELS, COMMON_ORDER, orderedClassCodes } from "./labels.js";

function renderClassTable(booked, web) {
  const codes = orderedClassCodes({ ...(booked || {}), ...(web || {}) });
  if (!codes.length) {
    return `<p class="empty-note">Aucun effectif reçu pour l'instant.</p>`;
  }
  const rows = codes
    .map((code) => {
      const b = Number(booked?.[code] || 0);
      const w = Number(web?.[code] || 0);
      return `<tr>
        <th scope="row">${escapeHtml(code)}</th>
        <td class="num">${b}</td>
        <td class="num">${w}</td>
      </tr>`;
    })
    .join("");
  const totalBooked = sum(booked);
  const totalWeb = sum(web);
  return `
    <table class="class-table">
      <thead>
        <tr><th scope="col">Classe</th><th scope="col">Réservé</th><th scope="col">Enregistré en ligne</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><th scope="row">Total</th><td class="num">${totalBooked}</td><td class="num">${totalWeb}</td></tr>
      </tfoot>
    </table>`;
}

function renderCommonGrid(common) {
  const c = common || {};
  const keys = COMMON_ORDER.filter((k) => Number(c[k] || 0) > 0);
  if (!keys.length) {
    return `<p class="empty-note">Aucune catégorie particulière signalée.</p>`;
  }
  const tiles = keys
    .map((k) => {
      const n = Number(c[k] || 0);
      const sensitive = ["WCH", "UMNR", "CHLD", "INF", "MAAS"].includes(k);
      return `<div class="tile${sensitive ? " tile-alert" : ""}">
        <div class="tile-count">${n}</div>
        <div class="tile-label">${escapeHtml(COMMON_LABELS[k] || k)}</div>
      </div>`;
    })
    .join("");
  return `<div class="tile-grid">${tiles}</div>`;
}

function renderConnections(rows, direction) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  const items = list
    .slice(0, 20)
    .map((r) => {
      const flight = escapeHtml(r.flight || "—");
      const airport = escapeHtml(direction === "inbound" ? r.from : r.to);
      const time = formatTime(r.time);
      const count = Number(r.paxCount || r.count || (Array.isArray(r.passengers) ? r.passengers.length : 0) || 0);
      return `<li><span class="conn-flight">${flight}</span> <span class="conn-airport">${airport}</span> <span class="conn-time">${time}</span> <span class="conn-count">${count} pax</span></li>`;
    })
    .join("");
  const title = direction === "inbound" ? "Correspondances arrivée" : "Correspondances départ";
  return `<div class="connections">
    <h3>${title}</h3>
    <ul>${items}</ul>
  </div>`;
}

export function renderFlightCard(flight) {
  const f = flight || {};
  const airline = escapeHtml(f.airline || "—");
  const flightNumber = escapeHtml(f.flight || "—");
  const date = formatDateFr(f.date);
  const dep = escapeHtml(f.dep || "");
  const dest = escapeHtml(f.dest || "");
  const std = formatTime(f.std);
  const sta = formatTime(f.sta);
  const route = dep && dest ? `${dep} → ${dest}` : dep || dest || "";
  const passengerCount = Array.isArray(f.passengers) ? f.passengers.length : 0;
  const status = String(f.imports?.status || "");
  const updatedAt = f.imports?.lastInjectionAt ? new Date(f.imports.lastInjectionAt).toLocaleString("fr-FR") : "";

  return `
    <article class="flight-card" data-identity="${escapeHtml(f.identity || "")}">
      <header class="flight-header">
        <div class="flight-title">
          <span class="flight-airline">${airline}</span>
          <span class="flight-number">${flightNumber}</span>
        </div>
        <div class="flight-meta">
          <span class="flight-date">${date}</span>
          ${route ? `<span class="flight-route">${route}</span>` : ""}
          ${f.std ? `<span class="flight-time">STD ${std}${f.sta ? ` · STA ${sta}` : ""}</span>` : ""}
        </div>
      </header>

      <section class="flight-section">
        <h2>Effectifs par classe</h2>
        ${renderClassTable(f.booked, f.web)}
      </section>

      <section class="flight-section">
        <h2>Catégories particulières</h2>
        ${renderCommonGrid(f.common)}
      </section>

      ${renderConnections(f.inbound, "inbound")}
      ${renderConnections(f.outbound, "outbound")}

      <footer class="flight-footer">
        <span>${passengerCount} passager${passengerCount > 1 ? "s" : ""} au dossier</span>
        ${status ? `<span class="status status-${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span>` : ""}
        ${updatedAt ? `<span class="updated-at">Mis à jour ${escapeHtml(updatedAt)}</span>` : ""}
      </footer>
    </article>`;
}
