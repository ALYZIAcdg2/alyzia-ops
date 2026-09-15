# V3 test Worker deployment

On the `feature/import-v3-staging` branch, `.github/workflows/deploy-v3-test.yml` can provision and deploy this isolated Worker using the repository's existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets. It runs only on pushes to that branch. The job first confirms the production D1 and R2 resources belong to the target account, then creates distinct V3 test resources if absent, applies the V3 migration and deploys the test Worker. If the token lacks D1 or R2 permission, the job fails before touching any production data. The V3 admin secret is derived for the test Worker within the runner and is never written to the repository or printed in the job logs.

Use `wrangler.v3.test.template.jsonc` to deploy a separate Worker named `alyzia-ops-v3-test`. It has no cron and no service binding. Its D1 and R2 names are distinct from production. The template deliberately does not contain a real D1 UUID or any Cloudflare credentials, so it cannot be used as-is for a production or test deploy.

1. With authenticated Cloudflare access, create D1 `alyzia-ops-v3-test-db` and R2 `alyzia-ops-v3-test-files`. Substitute only the new D1 UUID in a working copy of this config.
2. Set `V3_ADMIN_TOKEN` as a Worker secret, not a `vars` value or source file. Leave `V3_SHADOW_ENABLED=0` and `V3_CUTOVER_AIRLINES=""`.
3. Apply `migrations/0001_import_v3.sql` to the test D1, then deploy the branch using the working test config. The `/api/v3/status` endpoint confirms the staging tables exist. No old Gmail cron runs in this Worker.
4. Upload real SQ335/SQ337 PDF and EML documents to `/api/v3/sources` and call `/api/v3/process` with source evidence and correct flight hints. Call `/api/v3/compare` on each flight; inspect identity, classification, passenger counts, warnings and blocking errors. Then extend the comparison to TK, TW, BJ, VF and generic.

The test database starts empty. `import-existing` and `shadow` read only versions available in that same D1/R2 pair, so they cannot read production versions in this isolated Worker. Import test copies from Gmail/Drive or a controlled read-only export of existing production versions. The test Worker must never bind production `alyzia-ops-db` or `alyzia-ops-files`.

There is no reason to activate `V3_CUTOVER_AIRLINES` for the first comparisons. If later enabled for a test airline, `/api/v3/apply` writes only into the test D1 and still requires a `VALID` batch, an admin token and an unchanged baseline.

## Real-document check before deploy

On 15 September 2026, eight real attachments from the `PREPA SQ337/19AUG` mailbox message were checked locally with the V3 extractors and existing SQ interpreter: one EML JFE and seven PDFs. INF 4/4, FQTV 4/4 and 1/1, SSR 3/3, INBOUND 8/8, MEAL J 25/25 and Y 134/134 matched reported versus extracted passenger counts. The JFE EML classified as operational info. The partial set of seven PDFs consolidated to 160 distinct passengers and remained `WARNING` because the infant-parent relationship could not be confirmed. It did not include the MASTER manifest, so this is an extraction check rather than a complete flight comparison. Original files and passenger details are not in the repository.
