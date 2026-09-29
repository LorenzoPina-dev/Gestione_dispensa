import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const services = ['service-catalog','service-family','service-identity','service-inventory','service-jobs','service-notifications','service-privacy','service-shopping'];
for (const service of services) {
  const client = fs.readFileSync(path.join(root,'services',service,'src','db','postgres-client.ts'),'utf8');
  const context = fs.readFileSync(path.join(root,'services',service,'src','db','request-context.ts'),'utf8');
  assert.match(client, /set_config\('app\.user_id'/, `${service}: app.user_id propagation missing`);
  assert.match(client, /set_config\('app\.service'/, `${service}: app.service propagation missing`);
  assert.match(client, /applyRequestContext\(client, true\)/, `${service}: DB context must be transaction-local`);
  assert.match(context, /AsyncLocalStorage/, `${service}: context must be request-local`);
}
const migrations = fs.readdirSync(path.join(root,'infra/postgres/migrations')).filter((x) => /^\d{4}_[a-z0-9-]+\.sql$/.test(x));
const versions = migrations.map((x) => x.slice(0,4));
assert.equal(new Set(versions).size, versions.length, 'migration versions must be unique');
assert.ok(migrations.includes('0020_postgresql-rls.sql'), 'RLS migration must be discovered by the runner');
console.log('PASS: tenant context and migration version invariants hold.');
