#!/usr/bin/env node
// Read-only, explicitly invoked acceptance probe for Store/HQ staging.
// No login, secrets, writes, retries, SSH, deployment or paid requests.
import { resolveCname } from 'node:dns/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_HOST = 'staging-api.pamboo.asia';
export const PORTALS = [
  { name: 'store', host: 'staging-store.pamboo.asia' },
  { name: 'admin', host: 'staging-admin.pamboo.asia' },
];

const fail = (code) => {
  throw new Error(code);
};

export async function inspectStagingWeb({
  resolver = resolveCname,
  fetcher = fetch,
  timeoutMs = 8000,
} = {}) {
  const checks = [];
  async function check(name, verify) {
    try {
      await verify();
      checks.push({ name, status: 'PASS' });
    } catch (error) {
      // Never echo response content, network URL parameters or exception details.
      const reason = error instanceof Error && /^[A-Z_]{3,36}$/u.test(error.message)
        ? error.message
        : 'PROBE_ERROR';
      checks.push({ name, status: 'FAIL', reason });
    }
  }

  async function get(host, path) {
    // Host and path are deliberately fixed; no external/user-provided URLs.
    return fetcher(`https://${host}${path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  await check('api:health', async () => {
    const response = await get(API_HOST, '/health');
    if (response.status !== 200) fail('API_HEALTH_NOT_200');
  });
  await check('api:ready', async () => {
    const response = await get(API_HOST, '/ready');
    if (response.status !== 200) fail('API_READY_NOT_200');
  });

  for (const portal of PORTALS) {
    await check(`${portal.name}:dns-cname`, async () => {
      const records = await resolver(portal.host);
      const normalized = records.map((item) => item.toLowerCase().replace(/\.$/u, ''));
      if (!normalized.includes(API_HOST)) fail('CNAME_TARGET_MISMATCH');
    });
    await check(`${portal.name}:https-index`, async () => {
      const response = await get(portal.host, '/');
      if (response.status !== 200) fail('INDEX_NOT_200');
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
        fail('INDEX_NOT_HTML');
      }
      const html = await response.text();
      if (!/^\s*(?:<!doctype html|<html)\b/iu.test(html)) fail('INDEX_BODY_NOT_HTML');
    });
    await check(`${portal.name}:spa-deep-link`, async () => {
      const response = await get(portal.host, '/__xiaohai_readonly_probe__/nested');
      if (response.status !== 200) fail('SPA_ROUTE_NOT_200');
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
        fail('SPA_ROUTE_NOT_HTML');
      }
    });
    await check(`${portal.name}:missing-asset-404`, async () => {
      const response = await get(portal.host, '/assets/__xiaohai_readonly_nonexistent__.js');
      if (response.status !== 404) fail('ASSET_NOT_404');
    });
    await check(`${portal.name}:staff-no-token-401`, async () => {
      const response = await get(portal.host, '/api/v1/staff/me');
      if (response.status !== 401) fail('STAFF_NO_TOKEN_NOT_401');
    });
    await check(`${portal.name}:security-headers`, async () => {
      const response = await get(portal.host, '/');
      const headers = response.headers;
      if (response.status !== 200) fail('HEADER_PROBE_NOT_200');
      if (!headers.get('x-robots-tag')?.toLowerCase().includes('noindex')) fail('NOINDEX_MISSING');
      if (headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
        fail('NOSNIFF_MISSING');
      }
      if (headers.get('x-frame-options')?.toLowerCase() !== 'deny') fail('FRAME_DENY_MISSING');
    });
  }
  return {
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    process.stderr.write('Read-only staging probes are opt-in: node scripts/staging-web-smoke.mjs --run\n');
    process.exitCode = 2;
  } else {
    const result = await inspectStagingWeb();
    for (const item of result.checks) {
      process.stdout.write(`${item.status} ${item.name}${item.reason ? ' reason=' + item.reason : ''}\n`);
    }
    process.stdout.write(`STAGING_WEB_SMOKE passed=${result.passed} failed=${result.failed}\n`);
    // A green public smoke is NOT authenticated Store/HQ RBAC or deployment approval.
    if (result.failed > 0) process.exitCode = 1;
  }
}
