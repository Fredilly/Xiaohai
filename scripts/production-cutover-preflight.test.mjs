import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateProductionCutoverEnvironment } from './production-cutover-preflight.mjs';

const passphrase = 'synthetic-32-character-database-password';
const valid = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  API_REVISION: 'a'.repeat(40),
  WEB_REVISION: 'a'.repeat(40),
  API_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
  WORKER_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
  WEB_IMAGE_DIGEST: `sha256:${'c'.repeat(64)}`,
  POSTGRES_DB: 'xiaohai_production',
  POSTGRES_USER: 'xiaohai_production',
  POSTGRES_PASSWORD: passphrase,
  DATABASE_URL: `postgresql://xiaohai_production:${passphrase}@postgres:5432/xiaohai_production`,
  REDIS_URL: 'redis://redis:6379',
  WECHAT_APP_ID: `wx${'a'.repeat(16)}`,
  WECHAT_APP_SECRET: 'synthetic-local-contract-only-credential',
  CONSUMER_SESSION_SECRET: 'synthetic-unique-consumer-session-credential',
  STAFF_SESSION_SECRET: 'synthetic-unique-staff-session-credential',
  PICKUP_CODE_SECRET: 'synthetic-unique-pickup-code-credential',
  WECHAT_PAY_ENABLED: 'false',
  FOOD_STOCK_WRITES_ENABLED: 'false',
  FOOD_CHECKOUT_ENABLED: 'false',
  STORY_AI_ENABLED: 'false',
  PICTURE_BOOK_AI_ENABLED: 'false',
  PICTURE_BOOK_IMAGE_ENABLED: 'false',
  AI_MOCK_ENABLED: 'false',
  ANIMATION_AI_ENABLED: 'false',
  ANIMATION_VIDEO_ENABLED: 'false',
  ANIMATION_COMPOSITION_ENABLED: 'false',
};
for (const flag of [
  'CUTOVER_FINAL_APPROVED',
  'CUTOVER_STAGING_STOP_APPROVED',
  'CUTOVER_CAPACITY_EVIDENCE_VERIFIED',
  'CUTOVER_BACKUP_RESTORE_VERIFIED',
  'CUTOVER_ROLLBACK_EVIDENCE_VERIFIED',
  'CUTOVER_INGRESS_EVIDENCE_VERIFIED',
])
  valid[flag] = 'true';
for (const role of ['POSTGRES', 'REDIS', 'API', 'WORKER', 'WEB', 'EDGE']) {
  valid[`PRODUCTION_${role}_MEM_LIMIT`] = '128m';
}

test('cold cutover configuration is fail-closed without explicit approval and evidence', () => {
  assert.deepEqual(validateProductionCutoverEnvironment(valid), []);
  for (const field of [
    'CUTOVER_FINAL_APPROVED',
    'CUTOVER_STAGING_STOP_APPROVED',
    'CUTOVER_CAPACITY_EVIDENCE_VERIFIED',
    'CUTOVER_BACKUP_RESTORE_VERIFIED',
    'CUTOVER_ROLLBACK_EVIDENCE_VERIFIED',
    'CUTOVER_INGRESS_EVIDENCE_VERIFIED',
    'API_IMAGE_DIGEST',
    'WORKER_IMAGE_DIGEST',
    'WEB_IMAGE_DIGEST',
    'PRODUCTION_EDGE_MEM_LIMIT',
    'POSTGRES_PASSWORD',
    'REDIS_URL',
    'WECHAT_APP_ID',
    'WECHAT_APP_SECRET',
    'CONSUMER_SESSION_SECRET',
    'STAFF_SESSION_SECRET',
    'PICKUP_CODE_SECRET',
    'STORY_AI_ENABLED',
    'PICTURE_BOOK_IMAGE_ENABLED',
    'AI_MOCK_ENABLED',
    'WECHAT_PAY_ENABLED',
    'FOOD_STOCK_WRITES_ENABLED',
    'FOOD_CHECKOUT_ENABLED',
  ]) {
    assert.notDeepEqual(validateProductionCutoverEnvironment({ ...valid, [field]: '' }), [], field);
  }
  assert.notDeepEqual(
    validateProductionCutoverEnvironment({
      ...valid,
      DATABASE_URL: valid.DATABASE_URL.replace('@postgres:', '@staging-postgres:'),
    }),
    [],
  );
});

test('cold cutover owns one TLS ingress and isolates all persistent data from Staging', async () => {
  const compose = await readFile(
    new URL('../deploy/production-cutover.compose.yml', import.meta.url),
    'utf8',
  );
  const caddy = await readFile(
    new URL('../deploy/Caddyfile.production-cutover', import.meta.url),
    'utf8',
  );
  const active = compose
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.match(active, /name: xiaohai-production-cutover/u);
  assert.doesNotMatch(
    active,
    /\bbuild:|staging\.env|staging_postgres|staging_redis|external: true/u,
  );
  assert.equal((active.match(/\bports:/gu) ?? []).length, 1);
  assert.match(active, /'80:80'/u);
  assert.match(active, /'443:443'/u);
  for (const [name, digest] of [
    ['api', 'API'],
    ['worker', 'WORKER'],
    ['web', 'WEB'],
  ]) {
    assert.match(
      active,
      new RegExp(`  ${name}:\\n[\\s\\S]*?\\$\\{${digest}_IMAGE_DIGEST:\\?`, 'u'),
    );
  }
  assert.match(active, /data:\s*\n\s*internal: true/u);
  assert.match(active, /production_postgres_data:\/var\/lib\/postgresql\/data/u);
  assert.match(active, /production_redis_data:\/data/u);
  assert.match(active, /profiles: \[worker-approved\]/u);
  assert.match(caddy, /api\.pamboo\.asia/u);
  assert.match(caddy, /store\.pamboo\.asia/u);
  assert.match(caddy, /admin\.pamboo\.asia/u);
  assert.match(caddy, /reverse_proxy api:3000/u);
  assert.match(caddy, /reverse_proxy web:8080/u);
  assert.doesNotMatch(caddy, /import \/etc\/caddy\/Caddyfile\.staging|staging-api\.pamboo/u);
});

test('cutover template declares every gated value and stays closed by default', async () => {
  const template = await readFile(
    new URL('../deploy/production-cutover.env.example', import.meta.url),
    'utf8',
  );
  const fields = new Set(
    template
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => line.split('=')[0]),
  );
  for (const field of Object.keys(valid)) assert.ok(fields.has(field), field);
  const flags = Object.fromEntries(
    template
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => {
        const split = line.indexOf('=');
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  assert.notDeepEqual(validateProductionCutoverEnvironment(flags), []);
  for (const field of Object.keys(valid).filter((key) => key.startsWith('CUTOVER_'))) {
    assert.equal(flags[field], 'false');
  }
  assert.equal(flags.AI_MOCK_ENABLED, 'false');
});
