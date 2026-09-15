// Fusion et déduplication des passagers lors de l'injection dans une fiche
// de vol. Porté verbatim depuis src/index.js v1 (LOT 3).
//
// Deux régimes de correspondance :
// - SQ/TK/TW restent sur l'ancien comportement (clé = nom exact), comme
//   garde-fou historique, sans aucun changement.
// - Toutes les autres compagnies (y compris BJ/VF, qui partagent le
//   pipeline PD4ML) utilisent une correspondance hiérarchique : ETKT >
//   PNR+NOM > NOM+SIÈGE > NOM+CLASSE > NOM seul.

export function lot3PaxKey(p) {
  return String(p?.name || "").toUpperCase().replace(/[^A-Z0-9/]/g, "");
}

export function lot3IsProtectedSpecificAirline(airline) {
  // BJ retirée : elle utilise le même pipeline PD4ML que VF (déjà hors de
  // cette liste). Vérifié sur de vraies pièces jointes BJ : la liste
  // secondaire CHECK-IN LIST BOARDED extrait un nom erroné sur ce format
  // (colonnes différentes de VF) — le filet de sécurité du flux non protégé
  // (voir lot3UpsertPassengers) est nécessaire pour qu'une ligne mal
  // extraite ne devienne pas un faux passager permanent.
  return ["SQ", "TK", "TW"].includes(String(airline || "").trim().toUpperCase());
}

export function lot3PaxNameKey(p) {
  return String(p?.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function lot3PaxSeatKey(p) {
  return String(p?.seat || "").trim().toUpperCase().replace(/\s+/g, "");
}
export function lot3PaxClassKey(p) {
  return String(p?.class || p?.cabinClass || "").trim().toUpperCase();
}
export function lot3PaxPnrKey(p) {
  return String(p?.pnr || p?.recordLocator || p?.record_locator || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function lot3PaxEtktKeys(p) {
  const vals = [];
  const add = (v) => {
    if (v == null || v === "") return;
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    if (typeof v === "object") {
      add(v.number);
      add(v.documentNumber);
      add(v.document_number);
      add(v.id);
      return;
    }
    const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s) vals.push(s);
  };
  add(p?.etkt);
  add(p?.etkts);
  add(p?.tickets);
  add(p?.documentNumber);
  add(p?.documents?.etkt);
  return [...new Set(vals)];
}

// V50.26 — matching hiérarchique GENERIC uniquement.
// Ordre : ETKT > PNR+NOM > NOM+SIÈGE > NOM+CLASSE > NOM unique.
// SQ/TK/TW/BJ restent sur le comportement historique, sans aucun changement.
export function lot3FindPassengerIndex(passengers, incoming, airline) {
  const list = Array.isArray(passengers) ? passengers : [];
  if (lot3IsProtectedSpecificAirline(airline)) {
    const k = lot3PaxKey(incoming);
    return list.findIndex((p) => lot3PaxKey(p) === k);
  }

  const et = lot3PaxEtktKeys(incoming);
  if (et.length) {
    const hits = [];
    list.forEach((p, i) => {
      if (lot3PaxEtktKeys(p).some((v) => et.includes(v))) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
  }

  const name = lot3PaxNameKey(incoming);
  const pnr = lot3PaxPnrKey(incoming);
  if (name && pnr) {
    const hits = [];
    list.forEach((p, i) => {
      if (lot3PaxNameKey(p) === name && lot3PaxPnrKey(p) === pnr) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
  }

  const seat = lot3PaxSeatKey(incoming);
  if (name && seat) {
    const hits = [];
    list.forEach((p, i) => {
      if (lot3PaxNameKey(p) === name && lot3PaxSeatKey(p) === seat) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
  }

  const cls = lot3PaxClassKey(incoming);
  if (name && cls) {
    const hits = [];
    list.forEach((p, i) => {
      if (lot3PaxNameKey(p) === name && lot3PaxClassKey(p) === cls) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
  }

  if (name) {
    const hits = [];
    list.forEach((p, i) => {
      if (lot3PaxNameKey(p) === name) hits.push(i);
    });
    if (hits.length === 1) return hits[0];
  }
  return -1;
}

export function lot3CleanImportedPassenger(p) {
  const x = { ...(p || {}) };
  const bad = /\b(?:MASTER|TKNE|AS)\b/i;

  // MASTER / TKNE / AS ne sont pas des SSR à afficher dans les dossiers.
  x.ssr = [
    ...new Set(
      (Array.isArray(x.ssr) ? x.ssr : [])
        .map((v) => String(v || "").trim().toUpperCase())
        .filter((v) => v && !/^(MASTER|TKNE|AS)$/.test(v) && !/^\d{10,}/.test(v))
    ),
  ];

  // La spécificité doit être une vraie catégorie opérationnelle, pas un numéro billet.
  if ((/^\d{10,}/.test(String(x.specific || "")) || bad.test(String(x.specific || ""))) && !/^(TAHAT|DJURDJURA|WCHR|WCHS|WCHC|WCMP|WCBD|WCLB)$/i.test(String(x.specific || ""))) {
    x.specific = "";
  }

  if (/^\d{10,}/.test(String(x.note || "")) || /\bMASTER\b/i.test(String(x.note || ""))) {
    x.note = "";
  }

  delete x.document; // Colonne document inutile dans les listes génériques.
  return x;
}

export function lot3CleanGenericTokenText(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  // Jamais afficher ces jetons techniques comme SSR / spécificité.
  s = s
    .replace(/\bMASTER\b/gi, "")
    .replace(/\bTKNE\b/gi, "")
    .replace(/\bAS\b/gi, "")
    .replace(/\bETK[TN]?[-\s]*\d{10,}\b/gi, "")
    .replace(/\bEMD[-\s]*\d{10,}[A-Z0-9]*\b/gi, "")
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\s*[·,;/|-]\s*/g, " · ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export function lot3CleanGenericSsrArray(v) {
  const bad = new Set(["MASTER", "TKNE", "AS", ""]);
  const out = [];
  for (const raw of Array.isArray(v) ? v : [v]) {
    let s = String(raw || "").trim().toUpperCase();
    if (!s || bad.has(s)) continue;
    if (/^\d{10,}$/.test(s)) continue;
    if (/^ETK[TN]?[-\s]*\d{10,}/.test(s)) continue;
    if (/^EMD[-\s]*\d{10,}/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function lot3CleanImportedPassengerStrict(p) {
  const x = { ...(p || {}) };
  x.name = String(x.name || "").replace(/\s+/g, " ").trim();
  x.class = String(x.class || x.cabinClass || "").toUpperCase();
  x.cabinClass = x.class;
  x.title = String(x.title || "").toUpperCase();
  x.gender = String(x.gender || "").toUpperCase();
  x.passengerType = String(x.passengerType || "").toUpperCase();
  x.ssr = lot3CleanGenericSsrArray(x.ssr);
  x.specific = lot3CleanGenericTokenText(x.specific);
  x.note = lot3CleanGenericTokenText(x.note);
  if (x.cardKey === "MASTER") {
    x.ssr = [];
    x.specific = "";
    x.note = "";
  }
  if (x.cardKey === "ETKT") {
    x.ssr = [];
    x.specific = "";
    x.note = "";
  }
  if (x.cardKey === "EMD") {
    x.ssr = [];
    x.specific = "";
    x.note = "";
  }
  if (x.cardKey === "WEB") {
    x.ssr = [];
    x.specific = "";
    x.note = "";
    x.status = "WEB";
  }
  return x;
}

export function lot3MergePassengerInfo(a, b) {
  a = lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(a || {}));
  b = lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(b || {}));
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v == null || v === "") continue;
    if (k === "ssr") {
      out.ssr = [...new Set([...(Array.isArray(out.ssr) ? out.ssr : []), ...(Array.isArray(v) ? v : [v])].filter(Boolean))];
    } else if (k === "note") {
      const notes = [out.note, v].filter(Boolean).map((x) => String(x));
      out.note = [...new Set(notes)].join(" · ");
    } else if (k === "specific") {
      const vals = [out.specific, v].filter(Boolean).map((x) => String(x));
      out.specific = [...new Set(vals)].join(" · ");
    } else if (k === "fqtv") {
      out.fqtv = { ...(out.fqtv || {}), ...(v || {}) };
    } else if (!out[k]) {
      out[k] = v;
    }
  }
  return out;
}

export function lot3DedupePassengerArray(arr) {
  const out = [];
  const map = new Map();
  for (const raw of Array.isArray(arr) ? arr : []) {
    const p = lot3CleanImportedPassengerStrict(raw);
    const key = lot3PaxKey(p);
    if (!key) continue;
    if (map.has(key)) {
      const idx = map.get(key);
      out[idx] = lot3MergePassengerInfo(out[idx], p);
    } else {
      map.set(key, out.length);
      out.push(p);
    }
  }
  return out;
}

export function lot3CleanConnectionRows(rows, dir, base) {
  const out = [];
  const byFlight = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = { ...(raw || {}) };
    r.flight = String(r.flight || "").trim().toUpperCase();
    if (!r.flight || r.flight === "—" || r.flight === "-") continue;
    r.from = String(r.from || "").trim().toUpperCase();
    r.to = String(r.to || "").trim().toUpperCase();
    r.time = String(r.time || "").trim();
    r.passengers = lot3DedupePassengerArray(r.passengers || []);
    const key = r.flight;
    if (!byFlight.has(key)) {
      byFlight.set(key, out.length);
      out.push(r);
    } else {
      const cur = out[byFlight.get(key)];
      // Préférer la provenance réelle de la summary (ex YYZ) au faux CDG issu de la ligne INC.
      if ((!cur.from || cur.from === base.dep) && r.from && r.from !== base.dep) cur.from = r.from;
      if (!cur.to && r.to) cur.to = r.to;
      if (!cur.time && r.time) cur.time = r.time;
      cur.conx = cur.conx || r.conx || "";
      cur.classCounts = { ...(cur.classCounts || {}), ...(r.classCounts || {}) };
      cur.passengers = lot3DedupePassengerArray([...(cur.passengers || []), ...(r.passengers || [])]);
      cur.paxCount = Math.max(Number(cur.paxCount || 0), Number(r.paxCount || 0), cur.passengers.length);
      cur.count = Math.max(Number(cur.count || 0), Number(r.count || 0), cur.passengers.length);
    }
  }
  return out;
}

export function lot3SanitizeFlightGeneric(base) {
  if (!base || typeof base !== "object") return base;
  base.passengers = lot3DedupePassengerArray(base.passengers || []);
  if (base.common_lists && typeof base.common_lists === "object") {
    Object.keys(base.common_lists).forEach((k) => {
      base.common_lists[k] = lot3DedupePassengerArray(base.common_lists[k] || []);
    });
  }
  base.inbound = lot3CleanConnectionRows(base.inbound || [], "INBOUND", base);
  base.outbound = lot3CleanConnectionRows(base.outbound || [], "OUTBOUND", base);
  return base;
}

export function lot3NormalizePassengerForUi(p, card) {
  const x = { ...(p || {}) };
  const c = String(card?.cardKey || x.cardKey || "").toUpperCase();
  x.name = String(x.name || "").trim();
  x.class = String(x.class || x.cabinClass || "").toUpperCase();
  x.title = String(x.title || "").toUpperCase();
  x.gender = String(x.gender || "").toUpperCase();

  if (c === "WCH") {
    x.ssr = [x.category || x.specific || "WCH"].filter(Boolean);
  } else if (c === "FQTV") {
    x.ssr = ["FQTV"];
    if (!x.fqtv) x.fqtv = { tier: x.category || x.specific || "FQA", number: x.ffid || "" };
  } else if (c === "CHLD") {
    x.ssr = ["CHLD"];
  } else if (c === "INF") {
    x.ssr = ["INF"];
  } else if (c === "INBOUND" || c === "OUTBOUND") {
    x.ssr = [c];
  } else if (c === "EMD" || c === "ETKT" || c === "MASTER" || c === "WEB") {
    x.ssr = Array.isArray(x.ssr) ? x.ssr : [];
    if (c === "WEB") x.status = "WEB";
  } else if (c === "CONNECTIONS") {
    x.ssr = x.connection?.direction ? [String(x.connection.direction).toUpperCase()] : [];
  } else {
    x.ssr = [c].filter(Boolean);
  }

  if (c === "EMD" && !x.emd) x.emd = x.documentNumber || x.emd || "";
  if (c === "ETKT" && !x.etkt) x.etkt = x.documentNumber || x.etkt || "";
  x.sourceList = x.listName || card?.listName || "";
  x.imported = true;
  return lot3CleanImportedPassengerStrict(lot3CleanImportedPassenger(x));
}

export function lot3UpsertPassengers(base, card) {
  base.passengers = Array.isArray(base.passengers) ? base.passengers : [];
  const items = Array.isArray(card?.passengerItems) ? card.passengerItems : [];
  if (!items.length) return;

  const protectedFlow = lot3IsProtectedSpecificAirline(base.airline);
  const cardKey = String(card?.cardKey || "").toUpperCase();

  // Garde-fou absolu : on garde exactement l'ancien matching pour SQ/TK/TW/BJ.
  if (protectedFlow) {
    const byKey = new Map(base.passengers.map((p, i) => [lot3PaxKey(p), i]));
    for (const raw of items) {
      const p = lot3NormalizePassengerForUi(raw, card);
      const key = lot3PaxKey(p);
      if (!key) continue;
      if (byKey.has(key)) {
        const idx = byKey.get(key);
        base.passengers[idx] = lot3MergePassengerInfo(base.passengers[idx], p);
      } else if (cardKey === "MASTER" || !base.passengers.length || !byKey.has(key)) {
        byKey.set(key, base.passengers.length);
        base.passengers.push(p);
      }
    }
    return;
  }

  const hasMasterAlready = !!base.imports?.cards?.MASTER || base.passengers.some((p) => p?._genericMaster === true);

  for (const raw of items) {
    const p = lot3NormalizePassengerForUi(raw, card);
    if (!lot3PaxNameKey(p) && !lot3PaxEtktKeys(p).length) continue;

    const idx = lot3FindPassengerIndex(base.passengers, p, base.airline);
    if (idx >= 0) {
      const merged = lot3MergePassengerInfo(base.passengers[idx], p);
      if (cardKey === "MASTER") {
        merged._genericMaster = true;
        delete merged._genericProvisional;
      }
      base.passengers[idx] = merged;
      continue;
    }

    if (cardKey === "MASTER") {
      p._genericMaster = true;
      delete p._genericProvisional;
      base.passengers.push(p);
      continue;
    }

    // Avant l'arrivée du MASTER on garde temporairement l'information.
    // Dès que le MASTER est présent, une carte secondaire ne crée plus de faux dossier passager.
    if (!hasMasterAlready && !base.passengers.some((q) => q?._genericMaster === true)) {
      p._genericProvisional = true;
      base.passengers.push(p);
    }
  }

  if (cardKey === "MASTER") {
    // La population MASTER est l'autorité du dossier passager générique.
    // Les lignes secondaires non rapprochées restent dans leurs cartes/listes mais ne créent pas de dossier fantôme.
    base.passengers = base.passengers.filter((p) => p?._genericMaster === true || p?._genericProvisional !== true);
  }
}
