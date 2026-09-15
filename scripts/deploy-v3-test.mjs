import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) {
  throw new Error('Cloudflare account ID and API token are required.');
}

const prefix = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(method, path, body, allow404 = false) {
  const response = await fetch(`${prefix}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (allow404 && response.status === 404) return null;
  const data = await response.json();
  if (!response.ok || !data.success) {
    const detail = (data.errors || []).map(({ code, message }) => `${code}: ${message}`).join('; ');
    throw new Error(`Cloudflare ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return data;
}

function wrangler(args, input) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    ...(input ? { input } : {}),
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`Wrangler ${args[0]} failed.`);
}

// Reject a wrong account or an API token without read access before creating anything.
const productionDb = await api('GET', '/d1/database/2881327d-f2dd-4037-a395-f7095b32c69c');
if (productionDb.result?.name !== 'alyzia-ops-db') throw new Error('Production D1 does not match this account.');
const productionBucket = await api('GET', '/r2/buckets/alyzia-ops-files');
if (productionBucket.result?.name !== 'alyzia-ops-files') throw new Error('Production R2 does not match this account.');

const dbName = 'alyzia-ops-v3-test-db';
let testDb;
for (let page = 1; !testDb; page++) {
  const list = await api('GET', `/d1/database?per_page=100&page=${page}`);
  testDb = list.result.find(db => db.name === dbName);
  if (page >= (list.result_info?.total_pages || 1)) break;
}
if (!testDb) {
  const created = await api('POST', '/d1/database', { name: dbName, primary_location_hint: 'weur' });
  testDb = created.result;
  process.stdout.write('Created isolated V3 D1 database.\n');
}
if (!/^[a-f0-9-]{36}$/i.test(testDb.uuid || '')) throw new Error('Unexpected V3 D1 database ID.');

const bucketName = 'alyzia-ops-v3-test-files';
const bucket = await api('GET', `/r2/buckets/${bucketName}`, undefined, true);
if (!bucket) {
  await api('POST', '/r2/buckets', { name: bucketName, locationHint: 'weur' });
  process.stdout.write('Created isolated V3 R2 bucket.\n');
} else if (bucket.result?.name !== bucketName) {
  throw new Error('Unexpected V3 R2 bucket.');
}

const config = JSON.parse(readFileSync('wrangler.v3.test.template.jsonc', 'utf8'));
if (config.name !== 'alyzia-ops-v3-test' || config.triggers || config.services ||
    config.d1_databases?.[0]?.database_name !== dbName ||
    config.r2_buckets?.[0]?.bucket_name !== bucketName ||
    config.vars?.V3_CUTOVER_AIRLINES !== '') {
  throw new Error('V3 test config must remain isolated and cutover disabled.');
}
config.d1_databases[0].database_id = testDb.uuid;
const configPath = '.v3.test.generated.jsonc';
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

wrangler(['d1', 'execute', dbName, '--remote', '--file', 'migrations/0001_import_v3.sql', '-c', configPath]);
wrangler(['deploy', '-c', configPath]);
// A distinct, stable secret allows repeatable test deploys without printing an admin token.
const admin = createHmac('sha256', token).update(`alyzia-v3-test:${account}`).digest('hex');
wrangler(['secret', 'put', 'V3_ADMIN_TOKEN', '-c', configPath], admin + '\n');
process.stdout.write('Isolated V3 Worker deployed; admin token installed. Production bindings were not used.\n');
