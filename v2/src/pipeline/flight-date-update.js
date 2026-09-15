// Corrige la date de vol enregistrée quand la vraie date (lue sur la ligne
// rapport du document, ex. "AH1003 01SEP CDG STD1215") diffère de celle
// initialement détectée depuis le mail. Porté verbatim depuis src/index.js v1.

import { recordImportChange } from "../ingestion/document-store.js";

export async function lot2UpdateJobFlightDate(env, job, version, newIso, reason) {
  // V50.18 — D1 schema safe. import_file_versions n'a pas de colonne
  // flight_date : on ne modifie donc pas cette table. La date corrigée
  // devient authoritative dans gmail_messages / import_files / import_jobs
  // (et import_job_results via effectiveFlightDate, à l'appelant). Les ids
  // techniques file_id/version_id/job_id sont conservés tels quels même
  // s'ils contiennent l'ancienne date, pour ne jamais casser une clé primaire.
  if (!newIso || newIso === job.flight_date) return { changed: false, flightDate: job.flight_date };

  const oldDate = job.flight_date || "";
  const fileId = version.file_id || job.file_id || "";
  const versionId = version.version_id || job.version_id || "";
  const jobId = job.job_id || "";

  await env.OPS_DB.prepare(`
    UPDATE gmail_messages
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE gmail_message_id=?
  `).bind(newIso, job.gmail_message_id || version.gmail_message_id || "").run().catch(() => {});

  await env.OPS_DB.prepare(`
    UPDATE import_files
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE file_id=?
  `).bind(newIso, fileId).run().catch(() => {});

  await env.OPS_DB.prepare(`
    UPDATE import_jobs
    SET flight_date=?, updated_at=CURRENT_TIMESTAMP
    WHERE job_id=?
  `).bind(newIso, jobId).run().catch(() => {});

  await recordImportChange(env, {
    scope: "JOB",
    airline: job.airline,
    flightNumber: job.flight_number,
    flightDate: newIso,
    gmailMessageId: job.gmail_message_id,
    fileId: fileId,
    versionId: versionId,
    changeType: "FLIGHT_DATE_FROM_REPORT_LINE",
    before: { flightDate: oldDate, fileId, versionId, jobId },
    after: { flightDate: newIso, fileId, versionId, jobId, reason },
  }).catch(() => {});

  return { changed: true, flightDate: newIso, fileId, versionId, jobId };
}
