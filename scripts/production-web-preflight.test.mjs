import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateProductionWebEnvironment,
  validateProductionWebSource,
} from './production-web-preflight.mjs';
import { validateUnifiedProductionEnvironment } from './production-unified-preflight.mjs';

const revision = 'a'.repeat(40);
const valid = {
  WEB_REVISION: revision,
  PRODUCTION_API_UPSTREAM: 'https://api.pamboo.asia',
  PRODUCTION_HOST_ISOLATED: 'true',
};

test('requires a pinned code revision and a separate HTTPS production API origin', () => {
  assert.deepEqual(validateProductionWebEnvironment(valid), []);
  for (const [key, value] of [
    ['WEB_REVISION', 'main'],
    ['WEB_REVISION', ''],
    ['PRODUCTION_API_UPSTREAM', 'https://staging-api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.other.example.com'],
    ['PRODUCTION_API_UPSTREAM', 'https://staging-api.pamboo.asia.'],
    ['PRODUCTION_API_UPSTREAM', 'https://store.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://admin.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'http://api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.example.invalid'],
    ['PRODUCTION_API_UPSTREAM', 'https://user:secret@api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.pamboo.asia/api'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.pamboo.asia:8443'],
    ['PRODUCTION_HOST_ISOLATED', 'false'],
  ]) {
    assert.notEqual(
      validateProductionWebEnvironment({ ...valid, [key]: value }).length,
      0,
      `${key}=${value} should be refused`,
    );
  }
});

test('requires the exact checked-out commit and no uncommitted changes before packaging', () => {
  assert.deepEqual(validateProductionWebSource(valid, revision, ''), []);
  assert.notEqual(validateProductionWebSource(valid, 'b'.repeat(40), '').length, 0);
  assert.notEqual(
    validateProductionWebSource(valid, revision, ' M apps/store-web/src/main.tsx').length,
    0,
  );
});

test('unified production pins the API/Worker and web to the same reviewed SHA', () => {
  assert.deepEqual(validateUnifiedProductionEnvironment({ ...valid, API_REVISION: revision }), []);
  assert.notEqual(
    validateUnifiedProductionEnvironment({ ...valid, API_REVISION: 'b'.repeat(40) }).length,
    0,
  );
  assert.notEqual(
    validateUnifiedProductionEnvironment({ ...valid, API_REVISION: 'main' }).length,
    0,
  );
  assert.notEqual(
    validateUnifiedProductionEnvironment({
      ...valid,
      API_REVISION: revision,
      PRODUCTION_HOST_ISOLATED: 'false',
    }).length,
    0,
  );
});

test('production web is a standalone Caddy deployment without staging DB, workers or API images', async () => {
  const [caddy, dockerfile, compose, dockerignore] = await Promise.all([
    readFile(new URL('../deploy/Caddyfile.production-web', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/Dockerfile.production-web', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/production-web.compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
  ]);
  for (const host of ['store.pamboo.asia', 'admin.pamboo.asia'])
    assert.ok(caddy.includes(`${host} {`));
  assert.match(caddy, /@api path \/api \/api\/\* \/health \/ready/u);
  assert.match(caddy, /reverse_proxy \{\$PRODUCTION_API_UPSTREAM\}/u);
  assert.match(caddy, /root \* \/srv\/store/u);
  assert.match(caddy, /root \* \/srv\/admin/u);
  assert.match(caddy, /try_files \{path\} \/index\.html/u);
  assert.match(dockerfile, /ENV VITE_API_BASE_URL=""/u);
  assert.match(dockerfile, /--filter '@xiaohai\/store-web\.\.\.' build/u);
  assert.match(dockerfile, /--filter '@xiaohai\/admin-web\.\.\.' build/u);
  assert.match(dockerfile, /COPY --from=builder \/workspace\/apps\/store-web\/dist \/srv\/store/u);
  assert.match(dockerfile, /COPY --from=builder \/workspace\/apps\/admin-web\/dist \/srv\/admin/u);
  assert.match(compose, /PRODUCTION_API_UPSTREAM:\s*\$\{PRODUCTION_API_UPSTREAM:\?/u);
  assert.match(compose, /WEB_REVISION:\?/u);
  assert.doesNotMatch(compose, /postgres|redis|staging\.env|ghcr\.io|worker:/u);
  assert.match(dockerignore, /^\.env\.\*/mu);
});

test('production API domain has an isolated manual service definition and no automatic migrations', async () => {
  const [caddy, compose, ignore, dockerignore, miniapp, envExample] = await Promise.all([
    readFile(new URL('../deploy/Caddyfile.production-api', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/production-api.compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
    readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
    readFile(new URL('../apps/miniapp/config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../.env.production.example', import.meta.url), 'utf8'),
  ]);
  assert.match(caddy, /api\.pamboo\.asia \{/u);
  assert.match(caddy, /reverse_proxy api:3000/u);
  assert.match(compose, /ghcr\.io\/fredilly\/xiaohai-api:\$\{API_REVISION:\?/u);
  assert.match(compose, /ghcr\.io\/fredilly\/xiaohai-worker:\$\{API_REVISION:\?/u);
  assert.match(compose, /env_file: production\.env/u);
  const activeCompose = compose
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(
    activeCompose,
    /postgres:|redis:|staging\.env|migrate|seed|docker compose up/u,
  );
  assert.match(ignore, /^deploy\/production\.env$/mu);
  assert.match(dockerignore, /^deploy\/production\.env$/mu);
  assert.match(miniapp, /production: 'https:\/\/api\.pamboo\.asia'/u);
  assert.match(envExample, /^FOOD_STOCK_WRITES_ENABLED=false$/mu);
  assert.match(envExample, /^FOOD_CHECKOUT_ENABLED=false$/mu);
  assert.match(envExample, /^WECHAT_PAY_ENABLED=false$/mu);
});

test('one-server production topology serves all approved origins with a single public proxy', async () => {
  const [caddy, compose] = await Promise.all([
    readFile(new URL('../deploy/Caddyfile.production-unified', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/production-unified.compose.yml', import.meta.url), 'utf8'),
  ]);
  for (const host of ['api.pamboo.asia', 'store.pamboo.asia', 'admin.pamboo.asia']) {
    assert.ok(caddy.includes(`${host} {`), `Missing ${host}`);
  }
  assert.match(caddy, /@api path \/api \/api\/\* \/health \/ready/u);
  assert.equal((caddy.match(/reverse_proxy api:3000/gu) ?? []).length, 2);
  assert.match(compose, /ghcr\.io\/fredilly\/xiaohai-api:\$\{API_REVISION:\?/u);
  assert.match(compose, /ghcr\.io\/fredilly\/xiaohai-worker:\$\{API_REVISION:\?/u);
  assert.match(compose, /Dockerfile\.production-web/u);
  assert.match(compose, /Caddyfile\.production-unified/u);
  assert.equal((compose.match(/'80:80'/gu) ?? []).length, 1);
  assert.equal((compose.match(/'443:443'/gu) ?? []).length, 1);
  assert.doesNotMatch(compose, /^\s*(?:postgres|redis):/mu);
});
