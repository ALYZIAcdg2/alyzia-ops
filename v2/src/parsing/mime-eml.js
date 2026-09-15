// Décodeur MIME récursif pour les pièces jointes .eml (message/rfc822).
//
// Porté verbatim depuis src/index.js v1 (fonctions cleanXxxV3, à l'origine
// écrites pour sonder l'identité des mails SQ, puis réutilisées pour
// l'extraction de texte .eml de toutes les compagnies génériques — voir
// ../parsing/document-text.js). Gère multipart, base64 et quoted-printable.

import { lot2CleanText } from "./document-text.js";

export function cleanDecodeQuotedPrintableV3(s) {
  const src = String(s || "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const enc = new TextEncoder().encode(src[i]);
      for (const b of enc) bytes.push(b);
    }
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch (e) {
    return src;
  }
}

export function cleanDecodeMimeWordV3(v) {
  return String(v || "").replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_, cs, mode, data) => {
    try {
      if (String(mode).toUpperCase() === "B") {
        const bin = atob(String(data).replace(/\s+/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
      }
      return cleanDecodeQuotedPrintableV3(String(data).replace(/_/g, " "));
    } catch (e) {
      return data;
    }
  });
}

export function cleanParseHeadersV3(raw) {
  const unfolded = String(raw || "").replace(/\r?\n[ \t]+/g, " ");
  const out = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    out[k] = out[k] ? `${out[k]}, ${v}` : v;
  }
  return out;
}

export function cleanHeaderParamV3(value, name) {
  const s = String(value || "");
  const re = new RegExp(`(?:^|;)\\s*${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;]+))`, "i");
  const m = s.match(re);
  if (!m) return "";
  let v = String(m[1] ?? m[2] ?? "").trim();
  v = v.replace(/^UTF-8''/i, "");
  try {
    v = decodeURIComponent(v);
  } catch (e) {}
  return cleanDecodeMimeWordV3(v);
}

export function cleanBase64ToBytesV3(s) {
  try {
    const bin = atob(String(s || "").replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return new Uint8Array();
  }
}

export function cleanQuotedPrintableToBytesV3(s) {
  const txt = cleanDecodeQuotedPrintableV3(s);
  return new TextEncoder().encode(txt);
}

export function cleanSplitMimeEntityV3(raw) {
  const src = String(raw || "").replace(/\r\n/g, "\n");
  const idx = src.indexOf("\n\n");
  if (idx < 0) return { headers: {}, body: src };
  return { headers: cleanParseHeadersV3(src.slice(0, idx)), body: src.slice(idx + 2) };
}

export function cleanParseEmlRecursiveV3(rawText, depth = 0) {
  if (depth > 3) return { headers: {}, textBodies: [], attachments: [] };
  const entity = cleanSplitMimeEntityV3(rawText);
  const h = entity.headers;
  const ct = String(h["content-type"] || "text/plain");
  const disp = String(h["content-disposition"] || "");
  const enc = String(h["content-transfer-encoding"] || "").toLowerCase();
  const boundary = cleanHeaderParamV3(ct, "boundary");
  const filename = cleanHeaderParamV3(disp, "filename") || cleanHeaderParamV3(ct, "name");
  const mime = ct.split(";")[0].trim().toLowerCase() || "text/plain";

  if (mime.startsWith("multipart/") && boundary) {
    const marker = `--${boundary}`;
    const pieces = entity.body.split(marker).slice(1);
    const textBodies = [],
      attachments = [];
    for (let p of pieces) {
      p = p.replace(/^\r?\n/, "").replace(/\r?\n--\s*$/, "").trim();
      if (!p || p === "--") continue;
      const child = cleanParseEmlRecursiveV3(p, depth + 1);
      textBodies.push(...(child.textBodies || []));
      attachments.push(...(child.attachments || []));
    }
    return { headers: h, textBodies, attachments };
  }

  let bytes;
  if (enc === "base64") bytes = cleanBase64ToBytesV3(entity.body);
  else if (enc === "quoted-printable") bytes = cleanQuotedPrintableToBytesV3(entity.body);
  else bytes = new TextEncoder().encode(entity.body);

  if (mime === "message/rfc822") {
    const nestedText = new TextDecoder().decode(bytes);
    const nested = cleanParseEmlRecursiveV3(nestedText, depth + 1);
    return {
      headers: h,
      textBodies: nested.textBodies || [],
      attachments: [
        { filename: filename || "nested_message.eml", mimeType: "message/rfc822", bytes },
        ...(nested.attachments || []),
      ],
    };
  }

  const isText = mime === "text/plain" || mime === "text/html";
  const isAttachment = !!filename || /attachment/i.test(disp);
  if (isText && !isAttachment) {
    let t = new TextDecoder().decode(bytes);
    if (mime === "text/html") {
      t = t.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]+>/g, " ");
    }
    return { headers: h, textBodies: [lot2CleanText(t)], attachments: [] };
  }
  return { headers: h, textBodies: [], attachments: [{ filename: filename || "eml_part.bin", mimeType: mime, bytes }] };
}
