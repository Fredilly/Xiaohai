import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateProductionCohostEnvironment } from './production-cohost-preflight.mjs';

const password = 'synthetic-Passphrase-with-32-plus-chars!';
const revision = 'a'.repeat(40);
const valid = {
  WEB_REVISION: revision,
  API_REVISION: revision,
  COHOST_ARCHITECTURE_APPROVED: 'true',
  COHOST_INGRESS_EVIDENCE_VERIFIED: 'true',
  COHOST_CAPACITY_EVIDENCE_VERIFIED: 'true',
  PRODUCTION_BACKUP_RESTORE_VERIFIED: 'true',
  APP_ENV: 'production',
  NODE_ENV: 'production',
  POSTGRES_DB: 'xiaohai_production',
  POSTGRES_USER: 'xiaohai_prod_user',
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://xiaohai_prod_user:${encodeURIComponent(password)}@postgres:5432/xiaohai_production`,
  REDIS_URL: 'redis://redis:6379',
  WECHAT_PAY_ENABLED: 'false',
  FOOD_STOCK_WRITES_ENABLED: 'false',
  FOOD_CHECKOUT_ENABLED: 'false',
};

test('cohost preflight accepts only isolated synthetic production configuration with evidence flags', () => {
  assert.deepEqual(validateProductionCohostEnvironment(valid), []);
  for (const [key, value] of [
    ['WEB_REVISION', 'main'],
    ['API_REVISION', 'b'.repeat(40)],
    ['COHOST_ARCHITECTURE_APPROVED', 'false'],
    ['COHOST_INGRESS_EVIDENCE_VERIFIED', 'false'],
    ['COHOST_CAPACITY_EVIDENCE_VERIFIED', 'false'],
    ['PRODUCTION_BACKUP_RESTORE_VERIFIED', 'false'],
    ['APP_ENV', 'staging'],
    ['POSTGRES_DB', 'xiaohai_staging'],
    ['POSTGRES_USER', 'staging'],
    ['POSTGRES_PASSWORD', 'short'],
    [
      'DATABASE_URL',
      'postgresql://staging-user:staging-pass@staging-postgres:5432/xiaohai_staging',
    ],
    ['DATABASE_URL', 'postgresql://xiaohai_prod_user:wrong@postgres:5432/xiaohai_production'],
    ['REDIS_URL', 'redis://staging-redis:6379'],
    ['WECHAT_PAY_ENABLED', 'true'],
    ['FOOD_STOCK_WRITES_ENABLED', 'true'],
    ['FOOD_CHECKOUT_ENABLED', 'true'],
  ]) {
    assert.notEqual(
      validateProductionCohostEnvironment({ ...valid, [key]: value }).length,
      0,
      `${key} must fail closed`,
    );
  }
});

test('production services never publish host ports or mount staging data and edge exposes only API/web', async () => {
  const compose = await readFile(
    new URL('../deploy/production-cohost.compose.yml', import.meta.url),
    'utf8',
  );
  const active = compose
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.match(active, /name: xiaohai-production-cohost/u);
  assert.doesNotMatch(
    active,
    /\bports:|80:80|443:443|staging\.env|staging_private|staging_postgres|staging_redis/u,
  );
  assert.match(active, /production_postgres_data:\/var\/lib\/postgresql\/data/u);
  assert.match(active, /production_redis_data:\/data/u);
  assert.match(active, /production_edge:\s*\n\s*aliases: \[production-api\]/u);
  assert.match(active, /production_edge:\s*\n\s*aliases: \[production-web\]/u);
  assert.doesNotMatch(active, /^  api:/mu, 'shared edge must not add a DNS alias named api');
  const datastore = active.split('  production_api:')[0];
  assert.doesNotMatch(datastore, /production_edge/u);
  const worker = active.split('  worker:')[1].split('  web:')[0];
  assert.doesNotMatch(worker, /production_edge/u);
  assert.match(active, /data:\s*\n\s*internal: true/u);
  assert.match(active, /external: true\s*\n\s*name: xiaohai-production-edge/u);
  assert.doesNotMatch(active, /\bmigrate\b|\bseed\b/u);
});

test('shared proxy preserves original staging plus unknown sites and production never falls back to staging', async () => {
  const [sharedCaddy, webCaddy, override, stagingCaddy, stagingCompose, workflow, remote] =
    await Promise.all([
      readFile(new URL('../deploy/Caddyfile.cohost', import.meta.url), 'utf8'),
      readFile(new URL('../deploy/Caddyfile.production-cohost-web', import.meta.url), 'utf8'),
      readFile(new URL('../deploy/staging-cohost.override.yml', import.meta.url), 'utf8'),
      readFile(new URL('../deploy/Caddyfile', import.meta.url), 'utf8'),
      readFile(new URL('../deploy/staging.compose.yml', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/staging-deploy.yml', import.meta.url), 'utf8'),
      readFile(new URL('./staging-remote-deploy.sh', import.meta.url), 'utf8'),
    ]);
  assert.match(stagingCaddy, /^staging-api\.pamboo\.asia \{/mu);
  assert.match(stagingCompose, /name: xiaohai-staging/u);
  assert.match(sharedCaddy, /import \/etc\/caddy\/Caddyfile\.staging-base/u);
  assert.match(sharedCaddy, /import \/etc\/caddy\/Caddyfile\.preserved/u);
  for (const host of ['api.pamboo.asia', 'store.pamboo.asia', 'admin.pamboo.asia']) {
    assert.ok(sharedCaddy.includes(`${host} {`));
  }
  assert.match(sharedCaddy, /reverse_proxy production-api:3000/u);
  assert.match(sharedCaddy, /reverse_proxy production-web:8080/u);
  assert.doesNotMatch(sharedCaddy, /reverse_proxy api:3000/u);
  assert.match(webCaddy, /^:8080 \{/mu);
  assert.match(webCaddy, /@store host store\.pamboo\.asia/u);
  assert.match(webCaddy, /@admin host admin\.pamboo\.asia/u);
  assert.match(webCaddy, /respond "Unknown host" 404/u);
  assert.match(override, /Caddyfile\.preserved:\/etc\/caddy\/Caddyfile\.preserved:ro/u);
  assert.match(override, /Caddyfile:\/etc\/caddy\/Caddyfile\.staging-base:ro/u);
  assert.match(override, /networks:\s*\n\s*private: \{\}\s*\n\s*production_edge: \{\}/u);
  assert.match(workflow, /deploy\/staging-cohost\.override\.yml deploy\/Caddyfile\.cohost/u);
  assert.match(remote, /\[\[ -f cohost\.enabled \]\]/u);
  assert.match(remote, /production cohost containers exist but ingress marker is missing/u);
});
