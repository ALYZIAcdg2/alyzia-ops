// Fusion d'une carte classifiée (import_job_results) dans la fiche de vol
// existante. C'est le cœur de LOT 3 : construit base.booked/base.web
// (compteurs par classe), base.common/base.common_lists (WCH/CHLD/INF/EMD/
// ETKT/FQTV/STAFF/MEAL/UMNR/MAAS/INAD/DEPA/DEPU/CBAG), base.inbound/
// base.outbound (correspondances) et base.passengers (dossier consolidé).
// Porté verbatim depuis src/index.js v1 (LOT 3).

import { VF_MEAL_SSR_CODES } from "../parsers/vf.js";
import { lot3IdentityFromRow } from "./flight-card.js";
import {
  lot3SanitizeFlightGeneric,
  lot3UpsertPassengers,
  lot3NormalizePassengerForUi,
  lot3FindPassengerIndex,
  lot3MergePassengerInfo,
  lot3IsProtectedSpecificAirline,
  lot3PaxEtktKeys,
  lot3PaxPnrKey,
  lot3PaxNameKey,
  lot3PaxSeatKey,
} from "./passenger-merge.js";

export function lot3MergeFlightData(current, row, card) {
  let base = lot3SanitizeFlightGeneric(current && typeof current === "object" ? { ...current } : {});
  const identity = lot3IdentityFromRow(row);

  base.date = base.date || String(row.flight_date || "");
  base.airline = base.airline || String(row.airline || "").toUpperCase();
  base.flight = base.flight || String(row.flight_number || "").toUpperCase();
  base.identity = base.identity || identity;

  const imports = base.imports && typeof base.imports === "object" && !Array.isArray(base.imports) ? { ...base.imports } : {};

  const cards = imports.cards && typeof imports.cards === "object" && !Array.isArray(imports.cards) ? { ...imports.cards } : {};

  // Nettoyage de la bouillie historique : avant ce correctif, "sources"
  // s'accumulait sans limite sur TOUTES les cartes à chaque réinjection
  // (une copie complète de passengerItems par cycle), et "passengers"
  // dupliquait "passengerItems" partout. Sur un vol déjà volumineux (VF12),
  // ça peut suffire à elle seule à dépasser la limite de taille D1 même
  // pour l'écriture qui corrige UNE carte. On nettoie donc toutes les
  // cartes existantes ici, pas seulement celle en cours de traitement.
  for (const k of Object.keys(cards)) {
    if (!cards[k] || typeof cards[k] !== "object") continue;
    if (cards[k].passengers !== undefined) {
      cards[k] = { ...cards[k] };
      delete cards[k].passengers;
    }
    if (k !== "INBOUND_SUMMARY" && k !== "OUTBOUND_SUMMARY" && cards[k].sources !== undefined) {
      cards[k] = { ...cards[k] };
      delete cards[k].sources;
    }
  }

  const key = String(card.cardKey || "OTHER").toUpperCase();
  const previous = cards[key] && typeof cards[key] === "object" && !Array.isArray(cards[key]) ? cards[key] : null;

  // "sources" n'est relu QUE pour INBOUND_SUMMARY/OUTBOUND_SUMMARY
  // (agrégation des connectionRows de plusieurs documents). Pour toute
  // autre carte, cette liste n'est jamais relue nulle part : la conserver
  // ne fait qu'accumuler indéfiniment une copie complète de passengerItems
  // à CHAQUE reparse/réinjection du même document, ce qui a fait dépasser
  // la limite de taille d'une ligne D1 (SQLITE_TOOBIG) sur un vol VF déjà
  // volumineux. On déduplique par job_id pour qu'un même document réinjecté
  // plusieurs fois ne soit compté qu'une fois.
  const needsSources = key === "INBOUND_SUMMARY" || key === "OUTBOUND_SUMMARY";
  const dedupeSources = (list, incoming) => {
    const jobId = String(incoming?.source?.jobId || "");
    const kept = jobId ? list.filter((s) => String(s?.source?.jobId || "") !== jobId) : list.slice();
    kept.push(incoming);
    return kept;
  };

  // Protection corrections manuelles : si une carte porte manualLocked=true, on archive seulement la source.
  if (previous && previous.manualLocked === true) {
    cards[key] = { ...previous, serverUpdatedAt: new Date().toISOString() };
    if (needsSources) cards[key].sources = dedupeSources(Array.isArray(previous.sources) ? previous.sources : [], card);
    else delete cards[key].sources;
  } else {
    // Si plusieurs sources d'une même carte existent, on garde le plus haut
    // compteur en affichage et toutes les sources restent consultables.
    const prevCount = Number(previous?.passengerCount || 0);
    const nextCount = Number(card.passengerCount || 0);
    const display = nextCount >= prevCount ? card : previous;

    cards[key] = {
      ...(display || card),
      passengerCount: Math.max(prevCount, nextCount),
      serverUpdatedAt: new Date().toISOString(),
    };
    if (needsSources) cards[key].sources = dedupeSources(Array.isArray(previous?.sources) ? previous.sources : [], card);
    else delete cards[key].sources;
  }

  imports.cards = cards;
  imports.lastInjectionAt = new Date().toISOString();
  imports.lastInjectionLot = "LOT3";
  imports.status = "INJECTED";

  // Injection dans les structures déjà existantes de la fiche vol.
  base.common = base.common || {};
  base.common_lists = base.common_lists || {};
  base.booked = base.booked || {};

  lot3UpsertPassengers(base, card);

  if (card.cardKey === "MASTER") {
    Object.entries(card.classCounts || {}).forEach(([k, v]) => {
      const n = Number(v || 0);
      if (n > 0) base.booked[String(k).toUpperCase()] = n;
    });
  }

  if (card.cardKey === "WEB") {
    base.web = base.web || {};
    Object.entries(card.classCounts || {}).forEach(([k, v]) => {
      const n = Number(v || 0);
      if (n > 0) base.web[String(k).toUpperCase()] = Math.max(Number(base.web[String(k).toUpperCase()] || 0), n);
    });
  }

  const map = { WCH: "WCH", CHLD: "CHLD", INF: "INF", EMD: "EMD", ETKT: "ETK", FQTV: "FQTV", STAFF: "STAFF", MEAL: "MEAL", UMNR: "UMNR", MAAS: "MAAS", INAD: "INAD", DEPA: "DEPA", DEPU: "DEPU", CBAG: "CBAG" };
  const existingKey = map[String(card.cardKey || "").toUpperCase()];
  if (existingKey) {
    const count = Number(card.passengerCount || 0);
    if (count > 0) base.common[existingKey] = Math.max(Number(base.common[existingKey] || 0), count);
    if (Array.isArray(card.passengerItems) && card.passengerItems.length) {
      // Upsert par IDENTITÉ passager (ETKT/PNR+nom/...), jamais par contenu.
      // L'ancien code dédupliquait sur [name,seat,class,specific,note] : dès
      // qu'un correctif changeait specific/note pour un passager déjà
      // présent, la clé changeait et une DEUXIÈME entrée était ajoutée au
      // lieu de remplacer l'ancienne (corrompue).
      const list = Array.isArray(base.common_lists[existingKey]) ? base.common_lists[existingKey].slice() : [];
      for (const p0 of card.passengerItems) {
        const p = lot3NormalizePassengerForUi(p0, card);
        const masterIdx = lot3FindPassengerIndex(base.passengers || [], p, base.airline);
        const master = masterIdx >= 0 ? (base.passengers || [])[masterIdx] : null;
        // L'entrée de LISTE (p) doit rester la base du merge, pas le MASTER :
        // lot3MergePassengerInfo(a,b) ne réécrit jamais un champ déjà
        // renseigné dans a, donc fusionner (master,p) faisait hériter
        // cardKey="MASTER" sur CHAQUE entrée de carte dérivée (FQTV, CBAG,
        // MEAL...). Le MASTER ne sert donc qu'à compléter les champs
        // manquants (ETKT, code groupe...), jamais à écraser l'identité de
        // la carte.
        const merged = master ? lot3MergePassengerInfo(p, master) : p;
        const idx = lot3FindPassengerIndex(list, merged, base.airline);
        if (idx >= 0) list[idx] = merged;
        else list.push(merged);
      }
      base.common_lists[existingKey] = list;
    }
  }

  // Certaines compagnies livrent INC et ONC dans un seul PDF. On conserve la
  // source CONNECTIONS puis on injecte chaque passager dans la direction
  // portée par sa ligne I-/O-, sans créer de SSR technique CONNECTIONS.
  if (card.cardKey === "CONNECTIONS") {
    base.imports = imports;
    let merged = base;
    for (const direction of ["INBOUND", "OUTBOUND"]) {
      const passengerItems = (card.passengerItems || []).filter((p) => String(p?.connection?.direction || "").toUpperCase() === direction);
      if (!passengerItems.length) continue;
      merged = lot3MergeFlightData(merged, row, {
        ...card,
        cardKey: direction,
        label: direction,
        passengerItems,
        passengers: passengerItems,
        passengerCount: passengerItems.length,
        connectionRows: [],
      });
    }
    return lot3SanitizeFlightGeneric(merged);
  }

  // Certaines compagnies livrent enfants et bébés dans un seul PDF (ex.
  // "PDF-INFKID"). Chacun garde sa propre carte (INF ou CHLD) au lieu
  // d'être fusionné dans une carte unique.
  if (card.cardKey === "INFKID") {
    base.imports = imports;
    let merged = base;
    for (const type of ["INF", "CHLD"]) {
      const passengerItems = (card.passengerItems || []).filter((p) => String(p?.passengerType || "").toUpperCase() === type);
      if (!passengerItems.length) continue;
      merged = lot3MergeFlightData(merged, row, {
        ...card,
        cardKey: type,
        label: type,
        passengerItems,
        passengers: passengerItems,
        passengerCount: passengerItems.length,
      });
    }
    return lot3SanitizeFlightGeneric(merged);
  }

  // Source iPort (IZ/TB) : "PIL BY SSR CATEGORY" regroupe plusieurs
  // sections (MEALS/MEDICAL/SEATS/OTHER) dans un seul mail. Chaque
  // passager est routé vers sa vraie carte (MEAL/WCH/OTHER) via son SSR
  // réel, jamais fusionné dans une carte technique "IPORT_SSR".
  if (card.cardKey === "IPORT_SSR") {
    base.imports = imports;
    let merged = base;
    for (const target of ["MEAL", "WCH", "OTHER"]) {
      const passengerItems = (card.passengerItems || []).filter((p) => String(p?.iportSection || "").toUpperCase() === target);
      if (!passengerItems.length) continue;
      merged = lot3MergeFlightData(merged, row, {
        ...card,
        cardKey: target,
        label: target,
        passengerItems,
        passengers: passengerItems,
        passengerCount: passengerItems.length,
      });
    }
    return lot3SanitizeFlightGeneric(merged);
  }

  if (["INBOUND", "OUTBOUND", "INBOUND_SUMMARY", "OUTBOUND_SUMMARY"].includes(card.cardKey)) {
    const isInbound = card.cardKey === "INBOUND" || card.cardKey === "INBOUND_SUMMARY";
    const isSummary = card.cardKey === "INBOUND_SUMMARY" || card.cardKey === "OUTBOUND_SUMMARY";
    const dir = isInbound ? "inbound" : "outbound";

    // V50.28 STRICT CONNECTION MODEL — SUMMARY = metadata vols uniquement.
    // INC / ONC = passagers uniquement. La fiche vol expose ensuite UNE
    // LIGNE PAR PASSAGER, comme SQ.
    if (!isSummary && Array.isArray(card.passengerItems) && card.passengerItems.length) {
      const summaryKey = isInbound ? "INBOUND_SUMMARY" : "OUTBOUND_SUMMARY";
      const summaryCard = cards[summaryKey] || null;
      const summaryRows = [];
      const srcs = summaryCard && Array.isArray(summaryCard.sources) && summaryCard.sources.length ? summaryCard.sources : [summaryCard].filter(Boolean);
      for (const s of srcs) {
        for (const r of Array.isArray(s?.connectionRows) ? s.connectionRows : []) summaryRows.push(r);
      }
      if (!summaryRows.length && Array.isArray(summaryCard?.connectionRows)) summaryRows.push(...summaryCard.connectionRows);
      const byFlight = new Map(summaryRows.filter((r) => r?.flight).map((r) => [String(r.flight).toUpperCase(), r]));

      base[dir] = Array.isArray(base[dir]) ? base[dir] : [];
      // Remove prior generic rows produced by the same nominative list; summary rows are never displayed as pax rows.
      base[dir] = base[dir].filter((r) => {
        if (!r) return false;
        if (Array.isArray(r.passengers)) return false;
        const src = String(r.sourceList || "").toUpperCase();
        return src !== String(card.listName || "").toUpperCase();
      });

      for (const p0 of card.passengerItems) {
        const p = lot3NormalizePassengerForUi(p0, card);
        const conn = p.connection || {};
        const flight = String(conn.flight || "").trim().toUpperCase();
        if (!flight) continue;
        const meta = byFlight.get(flight) || {};
        const masterIdx = lot3FindPassengerIndex(base.passengers || [], p, base.airline);
        const master = masterIdx >= 0 ? (base.passengers || [])[masterIdx] : null;
        // Voir commentaire équivalent plus haut : p (la ligne OUTBOUND/
        // INBOUND) doit rester la base du merge, le MASTER ne fait que
        // compléter.
        const pax = master ? lot3MergePassengerInfo(p, master) : p;
        const airport = String(conn.airport || "").trim().toUpperCase();
        const metaFrom = String(meta.from || "").trim().toUpperCase();
        const metaTo = String(meta.to || "").trim().toUpperCase();
        const from = isInbound
          ? metaFrom && metaFrom !== String(base.dep || "").toUpperCase() && metaFrom !== String(base.dest || "").toUpperCase()
            ? metaFrom
            : airport || metaFrom
          : String(base.dest || metaFrom || "").toUpperCase();
        const to = isInbound
          ? String(base.dep || "CDG").toUpperCase()
          : metaTo && metaTo !== String(base.dep || "").toUpperCase() && metaTo !== String(base.dest || "").toUpperCase()
          ? metaTo
          : airport || metaTo;
        const rowOut = {
          ...pax,
          passenger: pax.name || pax.fullName || "",
          name: pax.name || pax.fullName || "",
          flight,
          from,
          to,
          // À défaut de résumé (OUTBOUND/INBOUND_SUMMARY vide, cas VF),
          // l'heure vient directement de la ligne passager elle-même (conn.std).
          time: String(meta.time || conn.std || "").trim(),
          conx: String(meta.conx || ""),
          class: pax.class || pax.cabinClass || "",
          sourceList: card.listName,
          connection: { ...conn, direction: isInbound ? "INBOUND" : "OUTBOUND", flight, airport },
        };
        const rowKey = [flight, lot3PaxEtktKeys(pax)[0] || lot3PaxPnrKey(pax) || lot3PaxNameKey(pax), lot3PaxSeatKey(pax)].join("|");
        const idx = base[dir].findIndex(
          (r) => [String(r.flight || "").toUpperCase(), lot3PaxEtktKeys(r)[0] || lot3PaxPnrKey(r) || lot3PaxNameKey(r), lot3PaxSeatKey(r)].join("|") === rowKey
        );
        if (idx >= 0) base[dir][idx] = lot3MergePassengerInfo(base[dir][idx], rowOut);
        else base[dir].push(rowOut);
      }
    }
  }

  // V50.28: after every generic card, refresh all list snapshots from the
  // consolidated master. Chaque entrée (p) reste la base du merge : le
  // MASTER ne fait que compléter les champs manquants (ETKT, code
  // groupe...), jamais écraser cardKey/listName/ssr/note de la carte
  // d'origine.
  //
  // Limité à la carte QUI VIENT D'ÊTRE TRAITÉE (existingKey) plutôt qu'à
  // TOUTES les cartes déjà accumulées : reparcourir l'intégralité de
  // common_lists à CHAQUE carte traitée pouvait dépasser le budget CPU du
  // Worker et laisser certaines cartes dérivées jamais persistées en base.
  if (!lot3IsProtectedSpecificAirline(base.airline) && existingKey && Array.isArray(base.common_lists[existingKey])) {
    base.common_lists[existingKey] = base.common_lists[existingKey].map((p) => {
      const idx = lot3FindPassengerIndex(base.passengers || [], p, base.airline);
      return idx >= 0 ? lot3MergePassengerInfo(p, base.passengers[idx]) : p;
    });
  }
  if (!lot3IsProtectedSpecificAirline(base.airline) && (card.cardKey === "INBOUND" || card.cardKey === "OUTBOUND")) {
    for (const dir of ["inbound", "outbound"]) {
      base[dir] = (base[dir] || []).map((p) => {
        const idx = lot3FindPassengerIndex(base.passengers || [], p, base.airline);
        return idx >= 0 ? lot3MergePassengerInfo(p, base.passengers[idx]) : p;
      });
    }
  }

  base.imports = imports;

  // VF SSR List : CBAG n'y est qu'une simple mention par passager ("CBAG :
  // CBAG- 8KG CAB"), sans carte dédiée. On en extrait une carte CBAG à la
  // volée (même mécanisme que CONNECTIONS ci-dessus), qui passe ensuite par
  // le "map" générique déjà en place pour WCH/MEAL/etc. FQTV reste
  // alimenté uniquement par sa propre liste dédiée VF FQTV List : le
  // dupliquer ici depuis SSR créerait des entrées non fusionnables
  // (note/specific différents) dans base.common_lists.FQTV. Important :
  // cet appel récursif doit venir APRÈS "base.imports=imports" ci-dessus,
  // sinon il écraserait la carte CBAG qu'il vient de créer avec l'ancien
  // "imports" local (sans CBAG) capturé en début de fonction.
  if (card.cardKey === "SSR" && Array.isArray(card.passengerItems)) {
    // Un passager SSR VF peut porter plusieurs codes à la fois (ex. CBAG +
    // BDML + DSML sur une même ligne). Sans filtrage, la carte CBAG
    // affichait aussi les codes repas du même passager et inversement : on
    // ne garde ici que le(s) code(s)/texte(s) pertinents pour la carte
    // dérivée en cours.
    const keepOnlyCodes = (items, codes) =>
      items.map((p) => ({
        ...p,
        ssr: (Array.isArray(p.ssr) ? p.ssr : []).filter((c) => codes.has(c)),
        note: String(p.note || "")
          .split(" · ")
          .filter((seg) => {
            const m = seg.match(/^([A-Z0-9]+)\s*:/);
            return m && codes.has(m[1]);
          })
          .join(" · "),
      }));
    const CBAG_CODES = new Set(["CBAG"]);
    const cbagItems = keepOnlyCodes(
      card.passengerItems.filter((p) => Array.isArray(p.ssr) && p.ssr.includes("CBAG")),
      CBAG_CODES
    );
    if (cbagItems.length) {
      base = lot3MergeFlightData(base, row, {
        ...card,
        cardKey: "CBAG",
        label: "CBAG",
        passengerItems: cbagItems,
        passengers: cbagItems,
        passengerCount: cbagItems.length,
        connectionRows: [],
      });
    }
    // Repas (BDML/CPDR/DSML/EBML...) : même principe que CBAG ci-dessus.
    const mealItems = keepOnlyCodes(
      card.passengerItems.filter((p) => Array.isArray(p.ssr) && p.ssr.some((s) => VF_MEAL_SSR_CODES.has(s))),
      VF_MEAL_SSR_CODES
    );
    if (mealItems.length) {
      base = lot3MergeFlightData(base, row, {
        ...card,
        cardKey: "MEAL",
        label: "MEAL",
        passengerItems: mealItems,
        passengers: mealItems,
        passengerCount: mealItems.length,
        connectionRows: [],
      });
    }
  }

  return lot3SanitizeFlightGeneric(base);
}
