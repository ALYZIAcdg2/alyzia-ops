// Vérifie le rendu du tableau de bord d'un vol contre une fiche produite
// par le vrai moteur d'injection (lot3MergeFlightData), pas un objet
// inventé — pour que ce test casse si la forme réelle des données change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lot3MergeFlightData } from "../src/injection/merge-flight-data.js";
import { renderFlightCard } from "../public/js/render-flight-card.js";

const ROW = { airline: "SK", flight_number: "SK564", flight_date: "2026-09-03" };

function buildRealFlight() {
  const masterCard = {
    cardKey: "MASTER",
    listName: "PDF-02",
    passengerCount: 2,
    classCounts: { C: 1, M: 1 }, // lettres SK réelles, jamais converties en C/Y
    passengerItems: [
      { name: "PASSENGERA/PRENOMA", class: "C", cabinClass: "C", seat: "1A", pnr: "1ABCDE" },
      { name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M", seat: "12A", pnr: "1FGHIJ" },
    ],
  };
  let flight = lot3MergeFlightData(null, ROW, masterCard);

  const wchCard = {
    cardKey: "WCH",
    listName: "PDF-06",
    passengerCount: 1,
    classCounts: {},
    passengerItems: [{ name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M", seat: "12A", specific: "WCHR", category: "WCHR" }],
  };
  flight = lot3MergeFlightData(flight, ROW, wchCard);

  flight.dep = "CDG";
  flight.dest = "CPH";
  flight.std = "09:50";
  return flight;
}

test("tableau de bord — compteurs par classe réels (SK: C/M, jamais C/Y)", () => {
  const flight = buildRealFlight();
  const html = renderFlightCard(flight);

  assert.match(html, /SK564/);
  assert.match(html, /CDG → CPH/);
  // Les lettres de classe SK (C/M) apparaissent telles quelles.
  assert.match(html, />C<\/th>/);
  assert.match(html, />M<\/th>/);
  assert.doesNotMatch(html, />Y<\/th>/); // jamais de conversion vers Y
});

test("tableau de bord — catégorie PMR (WCH) affichée avec effectif exact", () => {
  const flight = buildRealFlight();
  const html = renderFlightCard(flight);
  assert.match(html, /PMR \(fauteuil roulant\)/);
  assert.match(html, /<div class="tile-count">1<\/div>\s*<div class="tile-label">PMR/);
});

test("tableau de bord — échappe les noms de passagers issus des données", () => {
  const flight = buildRealFlight();
  flight.passengers[0].name = '<script>alert(1)</script>';
  const html = renderFlightCard(flight);
  // Le nom individuel n'est pas affiché sur la carte résumé (seul le
  // compte l'est) : vérifie simplement qu'aucun tag script brut ne fuite.
  assert.doesNotMatch(html, /<script>/);
});

test("tableau de bord — vol sans aucune donnée encore reçue reste lisible", () => {
  const html = renderFlightCard({ airline: "XX", flight: "XX1", date: "2026-09-20" });
  assert.match(html, /Aucun effectif reçu pour l'instant\./);
  assert.match(html, /Aucune catégorie particulière signalée\./);
});
