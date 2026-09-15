// Rendu de la liste des vols — écran d'accueil avant sélection d'un vol.
// Fonction pure, testable sans DOM (voir v2/tests/render-flight-list.test.js).

import { escapeHtml, formatDateFr, formatTime, sum } from "./format.js";

export function renderFlightList(flights) {
  const list = Array.isArray(flights) ? flights : [];
  if (!list.length) {
    return `<p class="empty-note">Aucun vol pour l'instant. Les vols apparaissent ici dès qu'un document a été reçu et classifié.</p>`;
  }

  const rows = list
    .map((f) => {
      const identity = escapeHtml(f.identity || "");
      const airline = escapeHtml(f.airline || "—");
      const flightNumber = escapeHtml(f.flight || "—");
      const date = formatDateFr(f.date);
      const route = f.dep && f.dest ? `${escapeHtml(f.dep)} → ${escapeHtml(f.dest)}` : "";
      const std = f.std ? formatTime(f.std) : "—";
      const booked = sum(f.booked);
      const web = sum(f.web);
      return `<tr class="flight-row" data-identity="${identity}" tabindex="0" role="button">
        <td>${date}</td>
        <td><span class="flight-airline">${airline}</span> <span class="flight-number">${flightNumber}</span></td>
        <td>${route}</td>
        <td class="num">${std}</td>
        <td class="num">${booked}</td>
        <td class="num">${web}</td>
      </tr>`;
    })
    .join("");

  return `
    <table class="flight-list">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Vol</th>
          <th scope="col">Route</th>
          <th scope="col">STD</th>
          <th scope="col">Réservé</th>
          <th scope="col">En ligne</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
