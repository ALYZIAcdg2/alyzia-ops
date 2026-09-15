// V50.30 R22.4 — BJ/VF pdf_ PRE-OPERATIONAL GATE. Porté verbatim depuis
// src/index.js v1.
//
// Règle : tout sujet Gmail OU nom de fichier logique de pièce jointe
// commençant par "pdf_" est un candidat opérationnel et NE DOIT JAMAIS être
// ignoré définitivement. Quand c'est possible, on résout l'identité BJ/VF
// directement depuis le contenu du PDF avant le stockage du document, pour
// que les chemins R2/D1 soient canoniques dès la première écriture. Si
// l'identité reste indisponible, le document est stocké quand même.

import { gmailFetch, b64urlToBytes } from "./gmail-client.js";
import { lot2ExtractPdfTextFromBytes } from "../parsing/document-text.js";
import { r223DetectBjVfIdentityFromPdfText } from "./bj-vf-identity.js";

export function r224IsPdfPrefixCandidate(subject, parts) {
  if (/^pdf_/i.test(String(subject || "").trim())) return true;
  return (Array.isArray(parts) ? parts : []).some((p) => /^pdf_/i.test(String(p?.filename || "").trim()));
}

export async function r224ProbeBjVfIdentityFromAttachments(env, messageId, subject, parts, attachmentCache) {
  const pdfPrefixCandidate = r224IsPdfPrefixCandidate(subject, parts);
  if (!pdfPrefixCandidate)
    return {
      candidate: false,
      identity: null,
      checked: 0,
      diagnostics: [],
    };

  let checked = 0;
  const diagnostics = [];

  for (const part of Array.isArray(parts) ? parts : []) {
    const attachmentId = String(part?.body?.attachmentId || "").trim();
    if (!attachmentId) continue;

    const filename = String(part?.filename || "attachment").trim();
    const mime = String(part?.mimeType || "application/octet-stream").trim();

    // If subject starts pdf_, accept its attachment even when Gmail gave a
    // generic/empty filename. Otherwise require the attachment prefix itself.
    const logicalPdfCandidate = /^pdf_/i.test(filename) || /^pdf_/i.test(String(subject || "").trim());

    if (!logicalPdfCandidate) continue;

    try {
      let bytes = attachmentCache.get(attachmentId);
      if (!bytes) {
        const att = await gmailFetch(env, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        bytes = b64urlToBytes(att.data || "");
        attachmentCache.set(attachmentId, bytes);
      }

      checked++;

      // Existing Worker PDF text engine only; no BJ/VF parser is invoked here.
      const ex = await lot2ExtractPdfTextFromBytes(bytes).catch((e) => ({
        text: "",
        error: String(e?.message || e),
      }));

      const text = String(ex?.text || "");
      const identity = r223DetectBjVfIdentityFromPdfText(text);

      diagnostics.push({
        filename,
        mime,
        checked: true,
        textLength: text.length,
        identity: identity || null,
        error: String(ex?.error || ""),
      });

      if (identity) {
        return {
          candidate: true,
          identity,
          checked,
          diagnostics,
        };
      }
    } catch (e) {
      diagnostics.push({
        filename,
        mime,
        checked: false,
        identity: null,
        error: String(e?.message || e),
      });
    }
  }

  return {
    candidate: true,
    identity: null,
    checked,
    diagnostics,
  };
}
