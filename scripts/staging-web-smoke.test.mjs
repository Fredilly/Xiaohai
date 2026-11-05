import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inspectStagingWeb, API_HOST, PORTALS } from './staging-web-smoke.mjs';

const modulePaths = {
  store: '/assets/store-B2x7.js',
  admin: '/assets/admin-Q8z4.js',
};
function page(site, src = modulePaths[site]) {
  const title = PORTALS.find((item) => item.name === site).title;
  return `<!doctype html><html lang="zh"><head><title>${title}</title></head><body><div id="root"></div><script type="module" crossorigin src="${src}"></script></body></html>`;
}
const headers = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function fixture({ dnsBad = false, broken = '', fetchFailure = false } = {}) {
  const visited = [];
  const resolver = async (hostname) => {
    assert.ok(PORTALS.some((portal) => portal.host === hostname));
    return [dnsBad ? 'unrelated.invalid.' : API_HOST + '.'];
  };
  const fetcher = async (address, init) => {
    const url = new URL(address);
    visited.push({ hostname: url.hostname, pathname: url.pathname });
    assert.equal(url.protocol, 'https:');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, { accept: 'text/html,application/json' });
    assert.equal('authorization' in init.headers, false);
    if (fetchFailure) throw new Error('sensitive network diagnostic not for output');
    if (url.hostname === API_HOST) {
      assert.ok(['/health', '/ready'].includes(url.pathname));
      return new Response('{}', { status: 200 });
    }
    assert.ok(PORTALS.some((portal) => portal.host === url.hostname));
    const label = url.hostname.startsWith('staging-store') ? 'store' : 'admin';
    if (url.pathname === '/api/v1/staff/me') {
      return new Response('{}', { status: broken === label + ':unauthorized' ? 200 : 401 });
    }
    if (url.pathname === '/assets/__xiaohai_readonly_nonexistent__.js') {
      return new Response('', { status: broken === label + ':asset' ? 200 : 404 });
    }
    if (url.pathname === modulePaths[label]) {
      if (broken === label + ':js-404') return new Response('', { status: 404 });
      if (broken === label + ':js-html') {
        return new Response(page(label), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('export {};', {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      });
    }
    if (url.pathname.startsWith('/__xiaohai_readonly_probe__')) {
      const deepApp = broken === label + ':deep-other-app' ? 'store' : label;
      const deepSrc = broken === label + ':deep-other-entry' ? '/assets/other-X7.js' : undefined;
      return new Response(page(deepApp, deepSrc), {
        status: broken === label + ':deep' ? 404 : 200,
        headers,
      });
    }
    assert.equal(url.pathname, '/');
    if (broken === label + ':redirect') return new Response('', { status: 302 });
    const servedApp = broken === 'both-store' && label === 'admin' ? 'store' : label;
    const source = broken === label + ':unsafe-js' ? 'https://bad.example/assets/x.js' : undefined;
    if (broken === label + ':headers') {
      return new Response(page(servedApp, source), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (broken === label + ':body') return new Response('not html', { status: 200, headers });
    return new Response(page(servedApp, source), { status: 200, headers });
  };
  return { resolver, fetcher, visited };
}

test('healthy Store/HQ probes verify 16 GET-only checks and actual entry JS assets', async () => {
  const environment = fixture();
  const result = await inspectStagingWeb(environment);
  assert.equal(result.failed, 0);
  assert.equal(result.passed, 16);
  for (const portal of PORTALS) {
    assert.ok(
      environment.visited.some(
        (item) => item.hostname === portal.host && item.pathname === modulePaths[portal.name],
      ),
    );
  }
  assert.equal(
    environment.visited.filter((item) => item.pathname === '/api/v1/staff/me').length,
    2,
  );
  assert.ok(result.checks.every((item) => item.status === 'PASS'));
});

for (const [broken, reason] of [
  ['store:asset', 'ASSET_NOT_404'],
  ['admin:unauthorized', 'STAFF_NO_TOKEN_NOT_401'],
  ['store:deep', 'SPA_ROUTE_NOT_200'],
  ['admin:redirect', 'INDEX_NOT_200'],
  ['admin:headers', 'NOINDEX_MISSING'],
  ['store:body', 'INDEX_BODY_NOT_HTML'],
  ['store:unsafe-js', 'ENTRY_JS_UNSAFE_SRC'],
  ['admin:js-404', 'ENTRY_JS_NOT_200'],
  ['store:js-html', 'ENTRY_JS_NOT_JAVASCRIPT'],
  ['admin:deep-other-entry', 'SPA_ENTRY_MISMATCH'],
  ['admin:deep-other-app', 'SPA_APP_MISMATCH'],
]) {
  test(`fails closed for ${broken}`, async () => {
    const result = await inspectStagingWeb(fixture({ broken }));
    assert.ok(result.checks.some((item) => item.status === 'FAIL' && item.reason === reason));
    assert.ok(result.failed > 0);
  });
}

test('both hosts serving the Store index fails HQ identity without false green', async () => {
  const result = await inspectStagingWeb(fixture({ broken: 'both-store' }));
  assert.equal(result.failed > 0, true);
  assert.ok(result.checks.some((item) => item.reason === 'APP_IDENTITY_MISMATCH'));
});

test('missing deployed JS on an otherwise valid index always fails', async () => {
  const result = await inspectStagingWeb(fixture({ broken: 'store:js-404' }));
  assert.equal(result.failed > 0, true);
  assert.ok(result.checks.some((item) => item.reason === 'ENTRY_JS_NOT_200'));
});

test('incorrect CNAME is a failure, not a DNS control-plane success claim', async () => {
  const result = await inspectStagingWeb(fixture({ dnsBad: true }));
  assert.equal(result.checks.filter((item) => item.reason === 'CNAME_TARGET_MISMATCH').length, 2);
});

test('network errors are sanitized and never expose diagnostics or response bodies', async () => {
  const result = await inspectStagingWeb(fixture({ fetchFailure: true }));
  assert.ok(result.failed > 0);
  assert.doesNotMatch(JSON.stringify(result), /sensitive network diagnostic/u);
  assert.ok(result.checks.some((item) => item.reason === 'PROBE_ERROR'));
});

test('without explicit --run the CLI does not contact staging', () => {
  const run = spawnSync(process.execPath, ['scripts/staging-web-smoke.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /opt-in/u);
  assert.doesNotMatch(run.stdout, /PASS|FAIL/u);
});
