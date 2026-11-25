import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  validateProductionWebEnvironment,
  validateProductionWebSource,
} from './production-web-preflight.mjs';

const revision = 'a'.repeat(40);
const valid = { WEB_REVISION: revision, PRODUCTION_API_UPSTREAM: 'https://api.pamboo.asia' };

test('requires a pinned code revision and a separate HTTPS production API origin', () => {
  assert.deepEqual(validateProductionWebEnvironment(valid), []);
  for (const [key, value] of [
    ['WEB_REVISION', 'main'],
    ['WEB_REVISION', ''],
    ['PRODUCTION_API_UPSTREAM', 'https://staging-api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://staging-api.pamboo.asia.'],
    ['PRODUCTION_API_UPSTREAM', 'https://store.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://admin.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'http://api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.example.invalid'],
    ['PRODUCTION_API_UPSTREAM', 'https://user:secret@api.pamboo.asia'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.pamboo.asia/api'],
    ['PRODUCTION_API_UPSTREAM', 'https://api.pamboo.asia:8443'],
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
