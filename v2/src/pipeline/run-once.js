// Enchaînement manuel sync → traitement → injection, pour valider le
// pipeline de bout en bout en un seul appel pendant la construction/
// validation de v2. Ce n'est PAS un portage du LOT 5 (orchestration cron +
// archivage Drive) de v1 — c'est un assemblage neuf des trois étapes déjà
// portées et testées séparément, pour un déclenchement manuel simple. Le
// vrai LOT 5 (cron automatique, archivage Drive) reste à porter avant la
// bascule finale.

import { gmailSyncNow } from "../ingestion/gmail-sync.js";
import { lot2ProcessNext } from "./process-job.js";
import { lot3InjectNext } from "../injection/inject.js";

export async function runPipelineOnce(env, body = {}) {
  const sync = await gmailSyncNow(env, { query: body.query, maxMessages: body.maxMessages, pageToken: body.pageToken });

  let processed = 0;
  let processRounds = 0;
  while (processRounds < 20) {
    const round = await lot2ProcessNext(env, { limit: 25 });
    processed += round.processed.length;
    processRounds++;
    if (round.found < 25) break;
  }

  let injected = 0;
  let injectRounds = 0;
  while (injectRounds < 20) {
    const round = await lot3InjectNext(env, { limit: 25, createMissingFlights: body.createMissingFlights === true });
    injected += round.injected.length;
    injectRounds++;
    if (round.found < 25) break;
  }

  return { ok: true, sync, processed, injected };
}
