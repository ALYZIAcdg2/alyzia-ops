// Suite de tests du moteur de classification, portée depuis les scripts de
// vérification ad hoc de la session de reconstruction (sk_samples.mjs,
// sk_run.mjs) — jusqu'ici de simples scripts jetables dans le scratchpad,
// maintenant une vraie suite exécutable avant chaque déploiement.
//
// Lancer : node --test v2/tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { lot2DetectListName, lot2LookupListMapping } from "../src/classification/list-mapping.js";
import { lot2ExtractClassCounts } from "../src/classification/class-counts.js";

// Échantillons réels SK564/SK560 (relevés Altea réels, un "PDF-<n>" par
// vol/section — la compagnie ne donne aucun nom de liste stable, seul le
// contenu permet de classifier).
const SK_SAMPLES = [
  [
    "PDF-02",
    "Generic Report\n02SEP2026 09:01:02 Z\nReport content\nLIST OF: PDF-02 C1 M23 TOTAL 24\nSK564 03SEP CDG STD0950 BOARD 0920 AO\n 1.PASSAGERSKA/PRENOMSKA F CDG CPH ML A 023A Y N \n I-AF51 IAD \n 2.PASSAGERSKB/PRENOMSKB M CDG CPH ML A 026C Y N \n I-AF51 IAD \n 2PCS 19KG \n 0AF174763 TA CPH\n 0AF174798 TA CPH\n 3.PASSAGERSKC/PRENOMSKC F CDG CPH MT A 021C Y N \n I-AF327 YOW \n 2PCS 20KG \n 0AF173276 TA CPH\n 0AF174252 TA CPH\n 4.PASSAGERSKD/PRENOMSKD M CDG CPH MR A 020D Y N \n I-AF75 RDU \n 1PCS 9KG \n 0AF178406 TA CPH\n 5.PASSAGERSKE/PRENOMSKE M CDG CPH MK Y Y \n I-AF1817 DUB \n 6.PASSAGERSKF/PRENOMSKF F CDG CPH MK Y Y \n I-AF1817 DUB \n 7.PASSAGERSKG/PRENOMSKG F CDG CPH MR A 020F Y N \n I-AF75 RDU \n 8.PASSAGERSKH/PRENOMSKH M CDG CPH MK Y Y \n I-AF1817 DUB \n 9.PASSAGERSKI/PRENOMSKI M CDG CPH MR A 026F Y N \n I-AF465 SSA \n 2PCS 27KG \n 0LA123175 TA CPH\n 0LA123684 TA CPH\n 10.PASSAGERSKJ/PRENOMSKJ F CDG CPH MT A 007C Y N \n I-AF345 YUL \n 11.PASSAGERSKK/PRENOMSKK M CDG CPH MO A 026D Y Y \n I-AF1391 IST \n 12.PASSAGERSKL/PRENOMSKL F CDG CPH MN A 028F Y N \n I-AV54 BOG \n 1PCS 22KG \n 0AV382672 TA CPH\n 13.PASSAGERSKM/PRENOMSKM F CDG CPH MX A 015C Y Y \n I-VN19 HAN \n 1PCS 20KG \n 0VN576852 TA TRD\n 14.PASSAGERSKN/PRENOMSKN M CDG CPH CJ A 002A ELIP Y N \n I-AF217 BOM \n 2PCS 28KG \n 0AF151008 TA CPH\n 0AF151009 TA CPH\n 15.PASSAGERSKO/PRENOMSKO M CDG CPH ME A 029F EBB Y Y \n I-SK9844 IST \n 16.PASSAGERSKP/PRENOMSKP F CDG CPH MR A 025F Y N \n I-AF453 GRU \n 17.PASSAGERSKQ/PRENOMSKQ F CDG CPH MU A 019F Y Y \n I-SK565 CPH \nReport content\n 18.PASSAGERSKR/PRENOMSKR F CDG CPH MT A 022A Y N \n I-AF279 HND \n 19.PASSAGERSKS/PRENOMSKS F CDG CPH MX A 023D Y Y \n I-AF673 RUN \n 2PCS 40KG \n 0AF152424 TA TRD\n 0AF152425 TA TRD\n 20.PASSAGERSKT/PRENOMSKT M CDG CPH MT A 022C Y N \n I-AF279 HND \n 21.PASSAGERSKU/PRENOMSKU F CDG CPH ML A 029D Y N \n I-AF345 YUL \n 22.PASSAGERSKV/PRENOMSKV M CDG CPH MX A 015A Y Y \n I-VN19 HAN \n 1PCS 22KG \n 0VN576805 TA TRD\n 23.PASSAGERSKW/PRENOMSKW F CDG CPH ML A 026A Y N \n I-AF345 YUL \n 24.PASSAGERSKX/PRENOMSKX M CDG CPH MX A 023F Y Y \n I-AF673 RUN",
    "MASTER",
  ],
  [
    "PDF-06",
    "Generic Report\n02SEP2026 09:00:46 Z\nReport content\nLIST OF: PDF-06 C1 M1 TOTAL 2\nSK564 03SEP CDG STD0950 BOARD 0920 AO\n 1.PASSAGERSKC/PRENOMSKC F CDG CPH MT A 021C Y N \n WCHS WCMP \n WCMP-53X36X36 6KG.PROVIDED REGULATIONS IN SALES PROCEDURES \n ARE MET \n 2.PASSAGERSKY/PRENOMSKY F CDG CPH CA 005C EBB N Y \n WCHR",
    "WCH",
  ],
  [
    "PDF-07",
    "Generic Report\n02SEP2026 09:00:30 Z\nReport content\nLIST OF: PDF-07 C0 M1 TOTAL 1\nSK564 03SEP CDG STD0950 BOARD 0920 AO\n 1.PASSAGERSKZ/PRENOMSKZ M CDG CPH MX A 007A ST N N \n HK STF-BK \n DOJ-10APR2026 \n 16M/M00",
    "STAFF",
  ],
  [
    "PDF-09",
    "Generic Report\n02SEP2026 09:00:36 Z\nReport content\nLIST OF: PDF-09 C1 M0 TOTAL 1\nSK564 03SEP CDG STD0950 BOARD 0920 AO\n 1.PASSAGERSKAA/PRENOMSKAA F CDG CPH CB A 002D N Y \n LGML-GU",
    "MEAL",
  ],
  [
    "PDF-92",
    "Generic Report\n02SEP2026 09:01:35 Z\nReport content\nLIST OF: PDF-92 C0 M1 TOTAL 1\nSK564 03SEP CDG STD0950 BOARD 0920 AO\n 1.PASSAGERSKC/PRENOMSKC F CDG CPH MT A 021C Y N \n WCHS WCMP CTCE \n CTCM EESS PARF \n WCMP-53X36X36 6KG.PROVIDED REGULATIONS IN SALES PROCEDURES \n ARE MET \n CTCE-FAKECONTACT01//EXAMPLE.COM \n CTCM-10000000001",
    "WCH",
  ],
  [
    "PDF-08",
    "Generic Report\n08SEP2026 05:16:47 Z\nReport content\nLIST OF: PDF-08 C0 M14 TOTAL 14\nSK560 09SEP CDG STD2015 BOARD 1945 AO\n 1.PASSAGERSKAB/PRENOMSKAB F CDG CPH MT N Y \n CTCE CTCM LGHT \n CTCE-FAKECONTACT02//EXAMPLE.COM \n CTCM-10000000002 \n LGHT-NO CARRY-ON BAG \n 2.PASSAGERSKAC/PRENOMSKAC F CDG CPH MO 022E N N \n ABAG CTCE CTCM \n LGHT \n CTCE-FAKECONTACT03//EXAMPLE.COM \n CTCM-10000000003 \n LGHT-NO CARRY-ON BAG",
    "OTHER",
  ],
  [
    "CHL-WEB",
    "Generic Report\n08SEP2026 05:16:15 Z\nReport content\nLIST OF: CHL-WEB C2 M39 TOTAL 41\nSK560 09SEP CDG STD2015 BOARD 1945 AO\n 1.PASSAGERSKAD/PRENOMSKAD F CDG CPH MO A 031F EBB N N \n CHL-WEB",
    "WEB",
  ],
  [
    "PDF-06, WCH",
    "Generic Report\n08SEP2026 05:17:03 Z\nReport content\nLIST OF: PDF-06, WCH C0 M3 TOTAL 3\nSK560 09SEP CDG STD2015 BOARD 1945 AO\n 1.PASSAGERSKAE/PRENOMSKAE F CDG CPH MO 008F N N \n WCHC \n WCHC-IF BRINGING OWN WHEELCHAIR PLS REQ WCBD/WCMP/WCBW \n 2.PASSAGERSKAF/PRENOMSKAF F CDG CPH MO 009F EBS N N \n WCHC \n WCHC-IF BRINGING OWN WHEELCHAIR PLS REQ WCBD/WCMP/WCBW \n 3.PASSAGERSKAG/PRENOMSKAG F CDG CPH MO 018C Y Y \n WCHR \n WCHR-PROVIDED REGULATIONS IN SALES PROCEDURES ARE MET",
    "WCH",
  ],
];

test("SK — classification par contenu sur relevés Altea réels", () => {
  for (const [label, text, expected] of SK_SAMPLES) {
    const listName = lot2DetectListName(text, "altea_report.pdf");
    const mapping = lot2LookupListMapping("SK", listName, text);
    assert.equal(
      mapping.cardKey,
      expected,
      `${label} : attendu ${expected}, obtenu ${mapping.cardKey} (listName=${JSON.stringify(listName)}, scope=${mapping.mappingScope})`
    );
  }
});

test("SQ — un sous-ensemble qualifié par virgule ne doit jamais être promu MASTER par comptage", () => {
  // Régression auto-détectée pendant la généralisation du repli sur suffixe :
  // "PDF-VBCPLIST, CC-Y" est un FILTRE PAR CLASSE du manifeste déjà posé par
  // "PDF-VBCPLIST" seul (mappé MASTER en dur pour SQ) — jamais un manifeste
  // à part entière, même avec beaucoup de lignes passager.
  const manyPaxLines = Array.from(
    { length: 20 },
    (_, i) => ` ${i + 1}.DOE/JOHN MR M CDG SIN`
  ).join("\n");
  const text = `LIST OF: PDF-VBCPLIST, CC-Y\n${manyPaxLines}`;
  const listName = lot2DetectListName(text, "altea_report.pdf");
  const mapping = lot2LookupListMapping("SQ", listName, text);
  assert.notEqual(mapping.cardKey, "MASTER");
});

test("SK — les lettres de classe ne sont jamais converties (M reste M)", () => {
  // Contrainte explicite de l'utilisateur : chaque compagnie garde ses
  // propres lettres de classe (SK: C/M, jamais C/Y). L'ancien code
  // convertissait M→Y et J→C ; ce bug est corrigé, à ne jamais réintroduire.
  const counts = lot2ExtractClassCounts("LIST OF: PDF-02 C1 M23 TOTAL 24");
  assert.equal(counts.M, 23);
  assert.equal(counts.C, 1);
  assert.equal(counts.Y, undefined);
});
