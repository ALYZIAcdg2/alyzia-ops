// Sondage d'identité SQ depuis les pièces jointes (quand sujet+corps ne
// suffisent pas), et expansion récursive des .eml SQ (corps texte + pièces
// jointes imbriquées). Porté verbatim depuis src/index.js v1.

import { gmailFetch, b64urlToBytes } from "./gmail-client.js";
import { cleanParseEmlRecursiveV3 } from "../parsing/mime-eml.js";
import { lot2ExtractPdfTextFromBytes, lot2CleanText } from "../parsing/document-text.js";
import { detectMailFlight, guessDocumentType, isPlainTextOperationalMail } from "./flight-identity.js";
import { plainTextOperationalKindV53 } from "./flight-identity.js";
import { cleanStoreDocumentV3, cleanNormalizeLinkSourceRefV35 } from "./document-store.js";

export async function cleanProbeAttachmentIdentitySQV3(env, messageId, subject, bodyText, parts, cache) {
  const current = detectMailFlight(subject, "", bodyText);
  const complete = () => current.airline === "SQ" && current.flightNumber && current.flightDate;
  if (complete()) return current;

  for (const part of parts || []) {
    if (complete()) break;
    const attachmentId = String(part.body?.attachmentId || "");
    if (!attachmentId) continue;
    try {
      let bytes = cache.get(attachmentId);
      if (!bytes) {
        const att = await gmailFetch(env, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        bytes = b64urlToBytes(att.data || "");
        cache.set(attachmentId, bytes);
      }
      const filename = String(part.filename || "");
      const mime = String(part.mimeType || "").toLowerCase();
      let probe = filename;
      if (/\.eml$/i.test(filename) || mime === "message/rfc822") {
        const raw = new TextDecoder().decode(bytes);
        const parsed = cleanParseEmlRecursiveV3(raw);
        probe += "\n" + raw.slice(0, 180000) + "\n" + (parsed.textBodies || []).join("\n");
      } else if (/\.pdf$/i.test(filename) || mime.includes("pdf")) {
        const ex = await lot2ExtractPdfTextFromBytes(bytes).catch(() => ({ text: "" }));
        probe += "\n" + String(ex?.text || "").slice(0, 120000);
      } else if (mime.startsWith("text/") || /\.(txt|csv|html?)$/i.test(filename)) {
        probe += "\n" + new TextDecoder().decode(bytes).slice(0, 120000);
      }
      const found = detectMailFlight(subject, filename, `${bodyText || ""}\n${probe}`);
      if (!current.airline && found.airline) current.airline = found.airline;
      if (!current.flightNumber && found.flightNumber) current.flightNumber = found.flightNumber;
      if (!current.flightDate && found.flightDate) current.flightDate = found.flightDate;
      if (current.airline && current.airline !== "SQ") break;
    } catch (e) {}
  }
  return current;
}

export async function cleanExpandSqEmlV3(env, { messageId, outerVersionId, outerAttachmentId, outerFilename, bytes, subject, receivedAt, flightBase }) {
  const raw = new TextDecoder().decode(bytes);
  const parsed = cleanParseEmlRecursiveV3(raw);
  let added = 0,
    duplicate = 0,
    virtualText = 0,
    nested = 0;
  let idx = 0;

  for (const body of parsed.textBodies || []) {
    const t = lot2CleanText(body);
    if (t.length < 20) continue;
    const found = detectMailFlight(subject, outerFilename, t);
    const flight = {
      airline: found.airline || flightBase.airline,
      flightNumber: found.flightNumber || flightBase.flightNumber,
      flightDate: found.flightDate || flightBase.flightDate,
    };
    if (flight.airline !== "SQ") continue;
    const kind = plainTextOperationalKindV53(subject, t);
    if (!kind && !/\bJFE\s+SCREEN\s+COPY\b/i.test(t)) continue;
    const filename = /\bJFE\s+SCREEN\s+COPY\b/i.test(t) ? `jfe_screen_copy_eml_${String(++idx).padStart(2, "0")}.txt` : `sq_eml_body_${String(++idx).padStart(2, "0")}.txt`;
    const r = await cleanStoreDocumentV3(env, {
      messageId,
      attachmentId: `${outerAttachmentId}:BODY:${idx}`,
      filename,
      mime: "text/plain; charset=UTF-8",
      bytes: new TextEncoder().encode(t),
      receivedAt,
      flight,
      docType: /JFE\s+SCREEN\s+COPY/i.test(t) ? "OPERATIONAL_INFO" : "SQ_TEXT",
      sourceKind: "EML_BODY",
      sourceRef: cleanNormalizeLinkSourceRefV35(`${outerAttachmentId}:BODY:${idx}`),
      parentVersionId: outerVersionId,
    });
    added += r.added || 0;
    duplicate += r.duplicate || 0;
    virtualText++;
    nested++;
  }

  let ai = 0;
  for (const child of parsed.attachments || []) {
    ai++;
    const filename = String(child.filename || `eml_attachment_${ai}.bin`);
    const mime = String(child.mimeType || "application/octet-stream");
    const childBytes = child.bytes instanceof Uint8Array ? child.bytes : new Uint8Array(child.bytes || []);
    if (!childBytes.byteLength) continue;

    let probe = "";
    if (/\.pdf$/i.test(filename) || mime.includes("pdf")) {
      const ex = await lot2ExtractPdfTextFromBytes(childBytes).catch(() => ({ text: "" }));
      probe = String(ex?.text || "");
    } else if (/\.eml$/i.test(filename) || mime === "message/rfc822" || mime.startsWith("text/")) {
      probe = new TextDecoder().decode(childBytes);
    }
    const found = detectMailFlight(subject, filename, probe);
    const flight = {
      airline: found.airline || flightBase.airline,
      flightNumber: found.flightNumber || flightBase.flightNumber,
      flightDate: found.flightDate || flightBase.flightDate,
    };
    if (flight.airline !== "SQ") continue;
    const docType = guessDocumentType(filename, mime, probe.slice(0, 5000));
    const r = await cleanStoreDocumentV3(env, {
      messageId,
      attachmentId: `${outerAttachmentId}:ATT:${ai}`,
      filename,
      mime,
      bytes: childBytes,
      receivedAt,
      flight,
      docType,
      sourceKind: "EML_ATTACHMENT",
      sourceRef: cleanNormalizeLinkSourceRefV35(`${outerAttachmentId}:ATT:${ai}`),
      parentVersionId: outerVersionId,
    });
    added += r.added || 0;
    duplicate += r.duplicate || 0;
    nested++;

    if ((/\.eml$/i.test(filename) || mime === "message/rfc822") && r.versionId) {
      const sub = await cleanExpandSqEmlV3(env, {
        messageId,
        outerVersionId: r.versionId,
        outerAttachmentId: `${outerAttachmentId}:ATT:${ai}`,
        outerFilename: filename,
        bytes: childBytes,
        subject,
        receivedAt,
        flightBase: flight,
      }).catch(() => ({ added: 0, duplicate: 0, virtualText: 0, nested: 0 }));
      added += sub.added || 0;
      duplicate += sub.duplicate || 0;
      virtualText += sub.virtualText || 0;
      nested += sub.nested || 0;
    }
  }
  return { added, duplicate, virtualText, nested };
}
