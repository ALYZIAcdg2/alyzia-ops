// Test de bout en bout de la fusion vers fiche de vol (LOT 3), sans base de
// données : lot3MergeFlightData est une fonction pure (objets JS en entrée,
// objet JS en sortie), donc directement testable. Vérifie le comportement
// central exigé par l'utilisateur : les compteurs par classe (base.booked)
// gardent les vraies lettres de classe de la compagnie (pas de conversion),
// et une carte secondaire (WCH) vient bien s'ajouter à côté du MASTER sans
// l'écraser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lot3MergeFlightData } from "../src/injection/merge-flight-data.js";

const ROW = { airline: "XX", flight_number: "XX100", flight_date: "2026-09-20" };

test("LOT3 — carte MASTER : compteurs par classe et dossier passager", () => {
  const masterCard = {
    cardKey: "MASTER",
    listName: "ALL CUSTOMERS",
    passengerCount: 2,
    classCounts: { C: 1, M: 1 }, // lettres "brutes" façon SK : jamais converties
    passengerItems: [
      { name: "PASSENGERA/PRENOMA", class: "C", cabinClass: "C", seat: "1A", pnr: "1ABCDE", etkt: "1234567890123" },
      { name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M", seat: "12A", pnr: "1FGHIJ" },
    ],
  };

  const flight = lot3MergeFlightData(null, ROW, masterCard);

  assert.equal(flight.identity, "2026-09-20|XX|XX100");
  assert.deepEqual(flight.booked, { C: 1, M: 1 });
  assert.equal(flight.passengers.length, 2);
  assert.equal(flight.passengers[0].name, "PASSENGERA/PRENOMA");
  assert.equal(flight.imports.cards.MASTER.passengerCount, 2);
});

test("LOT3 — une carte WCH secondaire s'ajoute sans écraser le MASTER", () => {
  const masterCard = {
    cardKey: "MASTER",
    listName: "ALL CUSTOMERS",
    passengerCount: 2,
    classCounts: { C: 1, M: 1 },
    passengerItems: [
      { name: "PASSENGERA/PRENOMA", class: "C", cabinClass: "C", seat: "1A", pnr: "1ABCDE" },
      { name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M", seat: "12A", pnr: "1FGHIJ" },
    ],
  };
  let flight = lot3MergeFlightData(null, ROW, masterCard);

  const wchCard = {
    cardKey: "WCH",
    listName: "WCH",
    passengerCount: 1,
    classCounts: {},
    passengerItems: [{ name: "PASSENGERB/PRENOMB", class: "M", cabinClass: "M", seat: "12A", pnr: "1FGHIJ", specific: "WCHR", category: "WCHR" }],
  };
  flight = lot3MergeFlightData(flight, ROW, wchCard);

  // Le MASTER garde ses 2 passagers et ses compteurs par classe.
  assert.equal(flight.passengers.length, 2);
  assert.deepEqual(flight.booked, { C: 1, M: 1 });
  // La carte WCH est comptée à part, sans toucher au MASTER.
  assert.equal(flight.common.WCH, 1);
  assert.equal(flight.common_lists.WCH.length, 1);
  assert.equal(flight.common_lists.WCH[0].name, "PASSENGERB/PRENOMB");
});

test("LOT3 — une carte OPERATIONAL_INFO ne touche pas aux passagers", () => {
  const masterCard = {
    cardKey: "MASTER",
    listName: "ALL CUSTOMERS",
    passengerCount: 1,
    classCounts: { Y: 1 },
    passengerItems: [{ name: "PASSENGERC/PRENOMC", class: "Y", cabinClass: "Y" }],
  };
  const flight = lot3MergeFlightData(null, ROW, masterCard);
  assert.equal(flight.passengers.length, 1);
  assert.equal(flight.booked.Y, 1);
});
