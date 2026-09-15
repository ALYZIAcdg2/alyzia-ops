// Porté verbatim depuis src/index.js v1 (handleFlightNotes) — notes de
// fiche vol et pièces jointes (stockées dans R2, indexées en D1).

import { json } from "../lib/http.js";
import { isAuthorizedPrepa } from "./auth.js";
import { sanitizeR2Segment, decodeBase64ToUint8Array } from "../lib/binary.js";

export async function handleFlightNotes(request, env, url) {
  if (!url.pathname.startsWith("/api/flight-notes") && !url.pathname.startsWith("/api/flight-attachments")) {
    return null;
  }

  if (request.method === "OPTIONS") return json({ ok: true });

  // Lecture libre pour l'instant comme le reste de v1. Les restrictions par
  // rôle arriveront à l'étape AUTH.
  if (url.pathname === "/api/flight-notes" && request.method === "GET") {
    const identity = String(url.searchParams.get("identity") || "").trim();
    if (!identity) return json({ ok: false, error: "IDENTITY MANQUANTE" }, 400);

    const { results = [] } = await env.OPS_DB.prepare(`
      SELECT
        id, flight_identity, airline, note_type, content,
        created_by, created_at, updated_at
      FROM flight_notes
      WHERE flight_identity=?
      ORDER BY created_at DESC, id DESC
    `).bind(identity).all();

    return json({ ok: true, count: results.length, notes: results });
  }

  if (url.pathname === "/api/flight-notes" && request.method === "POST") {
    if (!isAuthorizedPrepa(request, env)) {
      return json({ ok: false, error: "NON AUTORISE" }, 401);
    }

    const body = await request.json().catch(() => null);
    const identity = String(body?.flightIdentity || "").trim();
    const airline = String(body?.airline || "").trim().toUpperCase();
    const content = String(body?.content || "").trim();
    const noteType = String(body?.noteType || "COMPANY").trim().toUpperCase();
    const createdBy = String(body?.createdBy || "").trim();

    if (!identity || !airline || !content) {
      return json({ ok: false, error: "NOTE INVALIDE" }, 400);
    }

    const result = await env.OPS_DB.prepare(`
      INSERT INTO flight_notes
        (flight_identity, airline, note_type, content, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(identity, airline, noteType, content, createdBy).run();

    return json({ ok: true, id: Number(result.meta?.last_row_id || 0) });
  }

  if (url.pathname === "/api/flight-attachments" && request.method === "GET") {
    const identity = String(url.searchParams.get("identity") || "").trim();
    if (!identity) return json({ ok: false, error: "IDENTITY MANQUANTE" }, 400);

    const { results = [] } = await env.OPS_DB.prepare(`
      SELECT
        id, flight_identity, airline, note_id,
        file_name, original_file_name, mime_type, file_size,
        r2_key, uploaded_by, created_at
      FROM flight_attachments
      WHERE flight_identity=?
      ORDER BY created_at DESC, id DESC
    `).bind(identity).all();

    return json({ ok: true, count: results.length, attachments: results });
  }

  if (url.pathname === "/api/flight-attachments" && request.method === "POST") {
    if (!isAuthorizedPrepa(request, env)) {
      return json({ ok: false, error: "NON AUTORISE" }, 401);
    }
    if (!env.OPS_FILES) return json({ ok: false, error: "BINDING R2 OPS_FILES ABSENT" }, 500);

    const body = await request.json().catch(() => null);
    const identity = String(body?.flightIdentity || "").trim();
    const airline = String(body?.airline || "").trim().toUpperCase();
    const originalFileName = String(body?.fileName || "").trim();
    const mimeType = String(body?.mimeType || "application/octet-stream").trim();
    const base64 = String(body?.base64 || "");
    const uploadedBy = String(body?.uploadedBy || "").trim();
    const noteId = body?.noteId === null || body?.noteId === undefined ? null : Number(body.noteId);

    if (!identity || !airline || !originalFileName || !base64) {
      return json({ ok: false, error: "PIECE JOINTE INVALIDE" }, 400);
    }

    const bytes = decodeBase64ToUint8Array(base64);
    const MAX_BYTES = 12 * 1024 * 1024;
    if (bytes.byteLength > MAX_BYTES) {
      return json({ ok: false, error: "FICHIER TROP VOLUMINEUX (MAX 12 MB)" }, 413);
    }

    const allowedMime = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);

    if (!allowedMime.has(mimeType)) {
      return json({ ok: false, error: "TYPE DE FICHIER NON AUTORISE" }, 415);
    }

    const datePart = new Date().toISOString().slice(0, 10);
    const unique = crypto.randomUUID();
    const safeName = sanitizeR2Segment(originalFileName);
    const safeIdentity = sanitizeR2Segment(identity);
    const r2Key = `flights/${safeIdentity}/notes/${datePart}/${unique}_${safeName}`;

    await env.OPS_FILES.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        airline,
        flightIdentity: identity,
        uploadedBy: uploadedBy.slice(0, 120),
      },
    });

    const result = await env.OPS_DB.prepare(`
      INSERT INTO flight_attachments
        (flight_identity, airline, note_id, file_name, original_file_name,
         mime_type, file_size, r2_key, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(identity, airline, Number.isFinite(noteId) ? noteId : null, safeName, originalFileName, mimeType, bytes.byteLength, r2Key, uploadedBy).run();

    return json({
      ok: true,
      id: Number(result.meta?.last_row_id || 0),
      r2Key,
      fileName: originalFileName,
      size: bytes.byteLength,
    });
  }

  const attachmentMatch = url.pathname.match(/^\/api\/flight-attachments\/(\d+)$/);

  if (attachmentMatch && request.method === "GET") {
    const id = Number(attachmentMatch[1]);
    const row = await env.OPS_DB.prepare(`
      SELECT id, file_name, original_file_name, mime_type, r2_key
      FROM flight_attachments
      WHERE id=?
      LIMIT 1
    `).bind(id).first();

    if (!row) return json({ ok: false, error: "PIECE JOINTE INTROUVABLE" }, 404);
    if (!env.OPS_FILES) return json({ ok: false, error: "BINDING R2 OPS_FILES ABSENT" }, 500);

    const object = await env.OPS_FILES.get(row.r2_key);
    if (!object) return json({ ok: false, error: "FICHIER R2 INTROUVABLE" }, 404);

    const headers = new Headers();
    headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Disposition", `inline; filename="${String(row.original_file_name || row.file_name || "file").replace(/"/g, "")}"`);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(object.body, { status: 200, headers });
  }

  if (attachmentMatch && request.method === "DELETE") {
    if (!isAuthorizedPrepa(request, env)) {
      return json({ ok: false, error: "NON AUTORISE" }, 401);
    }

    const id = Number(attachmentMatch[1]);
    const row = await env.OPS_DB.prepare(`
      SELECT id, r2_key
      FROM flight_attachments
      WHERE id=?
      LIMIT 1
    `).bind(id).first();

    if (!row) return json({ ok: false, error: "PIECE JOINTE INTROUVABLE" }, 404);

    if (env.OPS_FILES) await env.OPS_FILES.delete(row.r2_key);
    await env.OPS_DB.prepare("DELETE FROM flight_attachments WHERE id=?").bind(id).run();

    return json({ ok: true, deleted: true, id });
  }

  return json({ ok: false, error: "ROUTE NOTES/PIECES JOINTES INTROUVABLE" }, 404);
}
