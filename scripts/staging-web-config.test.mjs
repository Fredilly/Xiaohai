import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fromRepo = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const candidate = await fromRepo('deploy/staging-web.Caddyfile');
const overlay = await fromRepo('deploy/staging-web.compose.yml');
const active = await fromRepo('deploy/Caddyfile');
const base = await fromRepo('deploy/staging.compose.yml');
const action = await fromRepo('.github/workflows/staging-web-validate.yml');

test('candidate is opt-in: existing production/staging deployment stays API-only', () => {
  assert.equal(
    active.trim(),
    'staging-api.pamboo.asia {\n  encode zstd gzip\n  reverse_proxy api:3000\n}',
  );
  assert.doesNotMatch(base, /staging-web\.Caddyfile|xiaohai-web|staging-web\.compose/u);
  assert.doesNotMatch(action, /ssh |scp |workflow_dispatch:|docker compose .*up -d/u);
});

test('each approved staging hostname serves ONLY its static site and same-origin API', () => {
  assert.equal((candidate.match(/^staging-api\.pamboo\.asia \{/gmu) ?? []).length, 1);
  assert.match(
    candidate,
    /staging-api\.pamboo\.asia \{\s*encode zstd gzip\s*reverse_proxy api:3000/u,
  );
  for (const [hostname, root] of [
    ['staging-store.pamboo.asia', 'store'],
    ['staging-admin.pamboo.asia', 'admin'],
  ]) {
    const block = candidate.slice(candidate.indexOf(hostname));
    assert.ok(block.startsWith(hostname + ' {'), hostname);
    assert.match(block, /@api path \/api\/\*/u);
    assert.match(block, /handle @api \{\s*reverse_proxy api:3000\s*\}/u);
    assert.ok(block.includes('/srv/xiaohai-web/' + root + '/current'));
    assert.match(block, /try_files \{path\} \/index\.html/u);
    assert.match(block, /X-Content-Type-Options nosniff/u);
    assert.match(block, /X-Frame-Options DENY/u);
  }
  assert.equal((candidate.match(/X-Robots-Tag "noindex, nofollow, noarchive"/gu) ?? []).length, 2);
  assert.doesNotMatch(candidate, /(?<!staging-)\b(?:api|store|admin)\.pamboo\.asia\s*\{/u);
  assert.doesNotMatch(candidate, /api\.example\.invalid|\*\.pamboo/u);
});

test('Compose overlay is only a read-only static mount and Caddy override', () => {
  assert.match(overlay, /staging-web\.Caddyfile:\/etc\/caddy\/Caddyfile:ro/u);
  assert.match(overlay, /\.\/web:\/srv\/xiaohai-web:ro/u);
  assert.doesNotMatch(overlay, /^  (?:api|worker|postgres|redis):/mu);
  assert.doesNotMatch(overlay, /:rw|privileged|network_mode|ports:/u);
});

test('browser builds use empty same-origin API base and CI cannot deploy or publish', () => {
  assert.match(action, /VITE_API_BASE_URL: ''/u);
  assert.match(action, /matrix:\s*site: \[store-web, admin-web\]/u);
  assert.match(action, /actions\/upload-artifact@v4/u);
  assert.doesNotMatch(action, /permissions:[\s\S]*?contents: write/u);
  assert.doesNotMatch(action, /github\.event\.workflow_run|secrets\./u);
});
