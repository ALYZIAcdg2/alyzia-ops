// Régression BJ/VF sur des relevés Altea réels, portée depuis les scripts
// de vérification ad hoc de la session (bj555test/run2.mjs) vers une vraie
// suite exécutable.
//
// Les fixtures sont le texte réellement extrait de trois PDF BJ555 réels
// (fqtv/pass2/checkin), avec noms de passagers, PNR, numéros FFID et
// numéros de billet remplacés par des valeurs synthétiques — la structure
// ligne par ligne exacte du document réel est conservée à l'identique
// (c'est elle qui exerce les trois bugs ci-dessous), seules les données
// personnelles ne le sont pas.
//
// Trois bugs réels corrigés cette session, chacun vérifié ici contre la
// structure du document réel qui l'a révélé :
// - FQTV : le niveau de carte ("WHITE") glué au FFID était relu comme un
//   second passager → 19 passagers extraits au lieu des 13 réels.
// - STAFF ("PASS2 PRINT") : titre non reconnu → carte jamais classifiée.
// - Check-In List Boarded : en-têtes tout en majuscules ("B. STS") pris
//   pour un nom de passager → premier passager erroné.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lot2VfListKindFromText, VF_LIST_CARD_KEYS, lot2VfExtractPassengerItems } from "../src/parsers/vf.js";

function fixtureText(name) {
  const path = fileURLToPath(new URL(`./fixtures/bj-vf/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

test("BJ FQTV — 13 passagers réels, pas 19 (niveau de carte non recompté)", () => {
  const text = fixtureText("fqtv.txt");
  const kind = lot2VfListKindFromText(text);
  assert.equal(kind, "FQTV");
  assert.equal(VF_LIST_CARD_KEYS[kind], "FQTV");

  const items = lot2VfExtractPassengerItems(text, kind);
  assert.equal(items.length, 13);

  const missingFfid = items.filter((i) => !i.ffid);
  assert.equal(missingFfid.length, 0, "chaque passager FQTV doit avoir un FFID");
});

test("BJ STAFF (PASS2 PRINT) — titre reconnu et classifié", () => {
  const text = fixtureText("pass2.txt");
  const kind = lot2VfListKindFromText(text);
  assert.equal(kind, "STAFF");
  assert.equal(VF_LIST_CARD_KEYS[kind], "STAFF");

  const items = lot2VfExtractPassengerItems(text, kind);
  assert.equal(items.length, 1);
});

test("BJ Check-In List Boarded — 34 passagers, premier nom correct (pas l'en-tête)", () => {
  const text = fixtureText("checkin.txt");
  const kind = lot2VfListKindFromText(text);
  assert.equal(kind, "CHECKIN");

  const items = lot2VfExtractPassengerItems(text, kind);
  assert.equal(items.length, 34);
  assert.notEqual(items[0].name.split("/")[0], "B. STS");
});
