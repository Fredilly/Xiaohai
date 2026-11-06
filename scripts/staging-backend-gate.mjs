#!/usr/bin/env node
// #203: compare CI HEAD with the last genuinely successful backend deployment.
// No contact with staging, Docker or GHCR. Unrecognized paths fail closed.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const runtimePaths = [
  /^apps\/(?:api|worker)\//u,
  /^packages\/(?:config|contracts|db|domain|validation)\//u,
  /^deploy\/(?!README\.md$)/u,
  /^scripts\/(?![^/]+\.test\.mjs$)/u,
  /^\.github\/workflows\/(?:ci|staging-deploy|staging-validation)\.yml$/u,
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|turbo\.json|docker-compose\.yml|\.dockerignore)$/u,
  /^\.env\.(?:example|staging\.example|production\.example)$/u,
];
const harmlessPaths = [
  /^apps\/(?:miniapp|admin-web|store-web)\//u,
  /^packages\/test-utils\//u,
  /^docs\//u,
  /^tests\//u,
  /^benchmarks\//u,
  /^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\//u,
  /^scripts\/[^/]+\.test\.mjs$/u,
  /^deploy\/README\.md$/u,
  /^(?:README\.md|AGENTS\.md|CONTRIBUTING\.md|LICENSE|\.gitignore|\.prettierignore|\.prettierrc\.json|eslint\.config\.mjs|playwright\.config\.ts|vitest\.config\.ts)$/u,
];

export function classifyPaths(paths) {
  if (!Array.isArray(paths)) throw new Error('invalid paths');
  const backend = [];
  const frontend = [];
  const unknown = [];
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\n') || path.startsWith('/')) {
      throw new Error('invalid changed path');
    }
    if (runtimePaths.some((pattern) => pattern.test(path))) backend.push(path);
    else if (harmlessPaths.some((pattern) => pattern.test(path))) frontend.push(path);
    else unknown.push(path);
  }
  if (unknown.length) {
    throw new Error(`unclassified changed paths (manual review required): ${unknown.join(', ')}`);
  }
  return { changed: backend.length > 0, backend, frontend };
}

export function changedPaths(base, head, cwd = process.cwd()) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('invalid baseline or CI SHA');
  const result = spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd });
  if (result.error || result.status !== 0) {
    throw new Error('baseline is unavailable or not an ancestor of CI HEAD');
  }
  // --no-renames preserves both sides of backend-to-frontend moves.
  const output = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

export function evaluate({ base, head, apiDigest, workerDigest, cwd }) {
  if (!DIGEST.test(apiDigest) || !DIGEST.test(workerDigest)) {
    throw new Error('last successful backend image digests are missing or invalid');
  }
  const paths = changedPaths(base, head, cwd);
  return { ...classifyPaths(paths), paths };
}

function main() {
  const base = process.env.STAGING_BACKEND_BASE_SHA ?? '';
  const head = process.env.STAGING_CI_SHA ?? '';
  const apiDigest = process.env.STAGING_BACKEND_API_DIGEST ?? '';
  const workerDigest = process.env.STAGING_BACKEND_WORKER_DIGEST ?? '';
  const result = evaluate({ base, head, apiDigest, workerDigest });
  const label = result.changed
    ? 'BACKEND_CHANGED -> BUILD_AND_DEPLOY'
    : 'FRONTEND_ONLY -> BACKEND_SKIP';
  const status = result.changed
    ? 'STAGING_DEPLOY_TRIGGERED'
    : 'STAGING_DEPLOY_SKIPPED: frontend-only';
  console.log(
    `${label} ci_sha=${head} last_success_sha=${base} last_api_digest=${apiDigest} last_worker_digest=${workerDigest} changed_files=${result.paths.length}`,
  );
  console.log(status);
  if (result.backend.length) console.log(`Backend-impacting paths: ${result.backend.join(', ')}`);
  if (!process.env.GITHUB_OUTPUT) throw new Error('missing GITHUB_OUTPUT');
  appendFileSync(process.env.GITHUB_OUTPUT, `backend_changed=${result.changed}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `baseline_sha=${base}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`STAGING_BACKEND_GATE_ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
