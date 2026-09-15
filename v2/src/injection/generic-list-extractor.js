// Extraction nominative pour toute liste Altea générique déjà classifiée
// par le moteur de classification (../classification/list-mapping.js).
// Porté verbatim depuis src/index.js v1 (V50.23).
//
// Prend le TEXTE d'une section "LIST OF: ..." déjà classifiée en cardKey
// (MASTER/FQTV/WCH/INC/etc.) et construit les objets passager structurés
// qui alimentent ensuite la fiche de vol : ticket/TKNE pour MASTER, palier
// fidélité pour FQTV, code SSR pour WCH, correspondance pour
// INBOUND/OUTBOUND, etc. — jamais de logique par compagnie ici, uniquement
// par cardKey déjà résolu.

import { lot2PassengerClassFromCode } from "../classification/class-counts.js";

export function lot2CleanPassengerName(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/\b(MR|MRS|MS|MISS|MSTR)\b$/i, " $1")
    .trim();
}

export function lot2SplitNameTitle(full) {
  const s = String(full || "").replace(/\s+/g, " ").trim();
  const m = s.match(/\b(MR|MRS|MS|MISS|MSTR)\s*$/i);
  const title = m ? m[1].toUpperCase() : "";
  const name = title ? s.replace(/\s+\b(MR|MRS|MS|MISS|MSTR)\s*$/i, "").trim() : s;
  return { name, title };
}

export function lot2SsrFromCard(cardKey, specific) {
  const c = String(cardKey || "").toUpperCase();
  const s = String(specific || "").toUpperCase();
  if (c === "ETKT" || c === "EMD" || c === "MASTER" || c === "WEB") return [];
  if (c === "FQTV") return ["FQTV", s].filter(Boolean);
  if (c === "CHLD") return ["CHLD"];
  if (c === "INF") return ["INF"];
  if (c === "WCH") return [s || "WCH"];
  if (c === "INBOUND_SUMMARY" || c === "OUTBOUND_SUMMARY") return [];
  if (c === "INBOUND") return ["INBOUND", s].filter(Boolean);
  if (c === "OUTBOUND") return ["OUTBOUND", s].filter(Boolean);
  if (c === "CONNECTIONS") return [];
  return [c, s].filter(Boolean);
}

export function lot2ExtractPassengerItemsFromGenericList(text, listName, cardKey) {
  // - MASTER/ALL CUSTOMERS : ticket ou TKNE jamais en SSR.
  // - FQTV : SSR=FQTV, catégorie=TAHAT/DJURDJURA, numéro carte séparé.
  // - WCH : SSR=WCHR/WCHS/...
  // - INC : noms liés au vol inbound réel.
  const lines = String(text || "").replace(/\r/g, "\n").split(/\n+/);
  const items = [];
  const cKey = String(cardKey || "").toUpperCase();
  const lName = String(listName || "").toUpperCase();

  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || "").replace(/\s+/g, " ").trim();
    const m = raw.match(/^\s*(\d{1,3})\.\s*(.+?)\s+([MFACI])\s+([A-Z]{3})\s+([A-Z]{3})\s+([A-Z]{1,2}[A-Z0-9]?)\s*(.*)$/i);
    if (!m) continue;

    const seq = Number(m[1]);
    const split = lot2SplitNameTitle(lot2CleanPassengerName(m[2]));
    const name = split.name;
    const title = split.title;
    const gender = String(m[3] || "").toUpperCase();
    const passengerType = gender === "C" ? "CHLD" : gender === "I" ? "INF" : "ADT";
    const origin = String(m[4] || "").toUpperCase();
    const destination = String(m[5] || "").toUpperCase();
    const cls = lot2PassengerClassFromCode(m[6]);
    const acceptance = String(m[6] || "").toUpperCase();
    const rest = String(m[7] || "").trim();
    const continuation = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = String(lines[j] || "").replace(/\s+/g, " ").trim();
      // Le format réel Altea n'a jamais d'espace après le point ("2.NOM"),
      // contrairement à l'ancienne regex qui exigeait "\s+" et ne s'arrêtait
      // donc jamais ici : chaque passager avalait tout le reste du document
      // jusqu'à la limite de 12 lignes.
      if (/^\d{1,3}\.\s*\S/.test(next)) break;
      if (/^(?:LIST\s+OF:|[A-Z0-9]{2,6}\s+\d{1,2}[A-Z]{3}\s+[A-Z]{3}\s+STD)/i.test(next)) break;
      // En-tête de page répété ("Report content") : bruit à ignorer, pas une fin de bloc.
      if (/^REPORT\s+CONTENT$/i.test(next)) continue;
      if (next) continuation.push(next);
      if (continuation.length >= 12) break;
    }
    const details = [rest, ...continuation].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const seatMatch = details.match(/\b0*(\d{1,3})([A-Z])\b/);
    const seat = seatMatch ? `${String(Number(seatMatch[1])).padStart(2, "0")}${seatMatch[2].toUpperCase()}` : "";

    const item = {
      id: `${cKey || "GEN"}-${seq}-${name}`,
      seq,
      name,
      title,
      gender,
      passengerType,
      class: cls,
      cabinClass: cls,
      origin,
      destination,
      acceptance,
      seat,
      specific: "",
      note: "",
      listName,
      cardKey: cKey,
      source: "GENERIC_LIST_OF",
      ssr: [],
    };

    if (cKey === "MASTER") {
      const tk = (details.match(/\b(\d{10,})\b/) || [])[1] || "";
      if (tk) item.etkt = tk;
      item.specific = "";
      item.note = "";
      item.ssr = [];
    } else if (cKey === "ETKT") {
      const tk = (details.match(/\b(\d{10,})\b/) || [])[1] || "";
      item.etkt = tk;
      item.documentNumber = tk;
      item.specific = "";
      item.ssr = [];
    } else if (cKey === "EMD") {
      const docs = [...details.matchAll(/\b(\d{10,}[A-Z0-9]*)\b/g)].map((x) => x[1]);
      const emd = docs.length > 1 ? docs[docs.length - 1] : docs[0] || "";
      item.emd = emd;
      item.documentNumber = emd;
      item.specific = "";
      item.ssr = [];
    } else if (cKey === "WCH") {
      const code = (details.match(/\b(WCHR|WCHS|WCHC|WCMP|WCBD|WCLB)\b/i) || [])[1] || "WCH";
      item.specific = String(code).toUpperCase();
      item.category = item.specific;
      item.ssr = [item.specific];
      item.codes = details.split(/\s+/).filter(Boolean);
      item.note = details;
    } else if (cKey === "FQTV") {
      const tokens = details.split(/\s+/).filter(Boolean);
      // Le numéro de billet/référence (ex. AF5378418086, KL5377187980) ne doit
      // jamais être pris pour un palier fidélité, quelle que soit la compagnie.
      const tier = tokens.find((t) => !/^(ACCRUAL|[A-Z]{2}\d{6,})$/i.test(t)) || "FQA";
      const next1 = String(lines[i + 1] || "").trim();
      const next2 = String(lines[i + 2] || "").trim();
      const ffid = (next1.match(/\b[A-Z]{2}\d{6,}\b/i) || [])[0] || "";
      item.specific = String(tier || "FQA").toUpperCase();
      item.category = item.specific;
      item.fqtv = { program: "AH", tier: item.specific, number: ffid, ffid };
      item.ssr = ["FQTV"];
      item.note = [ffid, next2 && /ACCRUAL/i.test(next2) ? "ACCRUAL" : ""].filter(Boolean).join(" · ");
    } else if (cKey === "INBOUND" || cKey === "OUTBOUND" || cKey === "CONNECTIONS") {
      const conn = details.match(/\b([IO])-([A-Z0-9]{2,5})\s+([A-Z]{3})\b/i);
      if (conn) {
        item.connection = {
          direction: conn[1].toUpperCase() === "I" ? "INBOUND" : "OUTBOUND",
          flight: conn[2].toUpperCase(),
          airport: conn[3].toUpperCase(),
        };
        item.specific = `${item.connection.direction} ${item.connection.flight} ${item.connection.airport}`;
      } else {
        item.specific = "";
      }
      item.ssr = item.connection ? [item.connection.direction] : [];
      item.note = details;
    } else if (cKey === "CHLD") {
      item.ssr = ["CHLD"];
      item.specific = "";
      item.note = details;
    } else if (cKey === "INF") {
      item.ssr = ["INF"];
      item.specific = "";
      item.note = details;
    } else if (cKey === "INFKID") {
      // Enfants/bébés combinés dans un seul document : chaque ligne garde
      // son vrai type (INF/CHLD), la séparation en cartes distinctes se
      // fait ensuite dans le fusionneur de fiche de vol.
      item.ssr = [item.passengerType === "INF" ? "INF" : "CHLD"];
      item.specific = "";
      item.note = details;
    } else if (cKey === "WEB") {
      item.status = "WEB";
      item.ssr = [];
      item.specific = "";
      item.note = "";
    } else if (cKey === "STAFF") {
      const staffCode = (details.match(/\b(STF-(?:BK|SB)|BOOKABLE\s+STAFF|REBATE\s+STAFF)\b/i) || [])[1] || "STAFF";
      item.category = String(staffCode).toUpperCase();
      item.specific = item.category;
      item.ssr = ["STAFF"];
      item.note = details;
    } else if (cKey === "MEAL") {
      const meal = (details.match(/\b([A-Z]{2}ML)(?:-[A-Z0-9]+)?\b/i) || [])[1] || "MEAL";
      item.category = String(meal).toUpperCase();
      item.specific = item.category;
      item.ssr = ["MEAL", item.category].filter((v, k, a) => a.indexOf(v) === k);
      item.note = details;
    } else {
      item.specific = details;
      item.ssr = lot2SsrFromCard(cKey, item.specific);
      item.note = details;
    }

    items.push(item);
  }

  return items;
}

export function lot2FqtvCategories(passengerItems) {
  const out = {};
  for (const p of passengerItems || []) {
    const cat = String(p.category || p.specific || "FQA").toUpperCase() || "FQA";
    out[cat] = (out[cat] || 0) + 1;
  }
  return out;
}
