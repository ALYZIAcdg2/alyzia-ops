# ALYZIA OPS — import V3

V3 is an independent staging pipeline. The current app, flight pages, Gmail scheduler and V2 import routes remain active. V3 does not import Gmail automatically or write flight pages during processing. Its source format is preserved in R2 at `v3/raw/{sha256}`; duplicate sources are linked by SHA-256 and origin reference. A ZIP or EML attachment becomes its own immutable raw source.

Stages: raw source → format extractor → normalized document (text, pages, metadata) → operating flight identity (airline, flight, raw date, internal date, route) → report classification → existing airline interpreter → per-flight consolidation → validation → comparison with the V2 flight → one conditional write. Each extracted document and decision is kept in separate D1 tables; no V3 processing path touches the old jobs, cards, or flights tables.

The SQL migration is `migrations/0001_import_v3.sql`. V3 endpoints also initialize these tables on first use. Existing V2 R2 versions can be read into V3 without changing their original object. All V3 endpoints except status require `Authorization: Bearer <V3_ADMIN_TOKEN>` with the Worker secret configured.

## Testing API

* `GET /api/v3/status` — staging counts.
* `POST /api/v3/shadow` with `{"limit":2}` — when `V3_SHADOW_ENABLED=1`, read the most recent unlinked V2 R2 versions and stage them in V3. The same mirror runs after the current Gmail cron, with no flight injection. Drive archives of these versions are represented by the same source IDs.
* `POST /api/v3/import-existing` with `{"versionId":"..."}` — copy a stored V2 version into V3 raw storage, extract and classify it. Use real PDF/EML/TXT versions already received to evaluate each airline.
* `POST /api/v3/sources` with `{"filename":"report.txt","contentBase64":"...","mimeType":"text/plain","sourceRef":"manual-1"}` — ingest a raw source without processing.
* `POST /api/v3/process` with `{"id":"raw-...","hints":{"flight":"SQ335","date":"2026-08-20","route":"CDG-SIN"}}` — process the source. Hints never erase contradictory document evidence.
* `GET /api/v3/compare?airline=SQ&flight=SQ335&date=2026-08-20` — produce a consolidated batch, validation report, and V2/V3 counts without injection.

Only `VALID` batches can apply. `WARNING` and `BLOCKING_ERROR` require review. Source identity and document classification must both be complete. Apply is disabled until the Worker environment explicitly sets `V3_CUTOVER_AIRLINES` to a comma-separated list such as `SQ`, and an operator invokes `POST /api/v3/apply` with the compared `batchId`. Apply and the shadow trigger require `Authorization: Bearer <V3_ADMIN_TOKEN>` with that Worker secret configured. The endpoint checks the comparison's V2 snapshot and refuses a concurrent flight change. Each flight is written once with all interpreted cards in memory; existing V2 job and injection tables remain untouched. Airline activation should follow comparison of real flights, particularly SQ335/SQ337, TK, TW, BJ, VF and generic reports.

Run `npm test`, `npm run check`, and `npx wrangler deploy --dry-run` before testing on a Worker. The suite covers SQ date and route evidence, BJ/VF conflicts, FQA, combined ONC/INC, extraction paths, ZIP unpacking and the validation barrier. Actual production attachments are not checked into this repository; run `import-existing` against stored versions for the real-document comparison.
