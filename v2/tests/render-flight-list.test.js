import { test } from "node:test";
import assert from "node:assert/strict";
import { lot3MergeFlightData } from "../src/injection/merge-flight-data.js";
import { renderFlightList } from "../public/js/render-flight-list.js";

test("liste des vols — état vide lisible", () => {
  const html = renderFlightList([]);
  assert.match(html, /Aucun vol pour l'instant/);
});

test("liste des vols — un vol réel apparaît avec ses compteurs", () => {
  const row = { airline: "SK", flight_number: "SK564", flight_date: "2026-09-03" };
  const flight = lot3MergeFlightData(null, row, {
    cardKey: "MASTER",
    listName: "PDF-02",
    passengerCount: 2,
    classCounts: { C: 1, M: 1 },
    passengerItems: [
      { name: "PASSENGERA/PRENOMA", class: "C", cabinClass: "C" },
      { name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M" },
    ],
  });
  flight.dep = "CDG";
  flight.dest = "CPH";
  flight.std = "09:50";

  const html = renderFlightList([flight]);
  assert.match(html, /SK564/);
  assert.match(html, /CDG → CPH/);
  assert.match(html, /data-identity="2026-09-03\|SK\|SK564"/);
});
