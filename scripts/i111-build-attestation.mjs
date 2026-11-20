import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const STOP = 'I111_BUILD_ATTESTATION_STOP';
const HEX40 = /^[0-9a-f]{40}$/u;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 20_000_000;

export const I111_BUILD_SOURCE_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/tsconfig.build.json',
  'apps/worker/package.json',
  'apps/worker/tsconfig.json',
  'apps/worker/tsconfig.build.json',
  'scripts/i111-one-shot-policy.mjs',
  'scripts/i111-build-attestation.mjs',
  'scripts/i111-one-shot-orchestration.mjs',
  'scripts/i111-readonly-runtime-preflight.mjs',
  'scripts/i111-reviewed-control-ports.mjs',
  'scripts/i111-exclusive-pg-lock.mjs',
  'scripts/i111-paid-operation-grant.mjs',
  'scripts/i111-db-evidence-ports.mjs',
  'scripts/i111-formal-api-worker-ports.mjs',
  'apps/api/src/picture-book/i111-source-bound-service.ts',
  'apps/api/src/picture-book/picture-book-service.ts',
  'apps/api/src/picture-book/image-queue.ts',
  'apps/worker/src/i111-source-bound-target.ts',
  'apps/worker/src/i111-paid-attempt-gate.ts',
  'apps/worker/src/i111-single-paid-fetch.ts',
  'apps/worker/src/image-processor.ts',
  'apps/worker/src/image-provider.ts',
  'apps/worker/src/bos-storage.ts',
  'apps/worker/src/private-bos-reference.ts',
  'packages/config/src/image-runtime-safety.ts',
]);

const DIST_DIRS = Object.freeze(['apps/api/dist', 'apps/worker/dist']);

function fail() {
  throw new Error(STOP);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.error || result.status !== 0 || result.stderr) fail();
  return result.stdout.trim();
}

async function hashRegularFile(root, path) {
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith(`..${sep}`) || relative(root, absolute) === '..') fail();
  const info = await lstat(absolute);
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) fail();
  const file = await open(absolute, 'r');
  try {
    const bytes = await file.readFile();
    const after = await file.stat();
    if (
      bytes.length !== info.size ||
      after.size !== info.size ||
      after.ino !== info.ino ||
      after.dev !== info.dev ||
      after.mtimeMs !== info.mtimeMs
    )
      fail();
    return digest(bytes);
  } finally {
    await file.close();
  }
}

async function collectDist(root, path, output) {
  const absolute = resolve(root, path);
  const info = await lstat(absolute);
  if (!info.isDirectory()) fail();
  const entries = (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );
  if (!entries.length) fail();
  for (const entry of entries) {
    if (output.length >= MAX_FILES || entry.name === '.' || entry.name === '..') fail();
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await collectDist(root, child, output);
    else if (entry.isFile()) output.push([child, await hashRegularFile(root, child)]);
    else fail(); // Symlinks and special files are never valid build artifacts.
  }
}

/**
 * Read-only build observations for an INDEPENDENT later review. This function
 * DOES NOT establish build provenance or approve a paid operation. In
 * particular, a manifest can be forged or produced from stale dist bytes.
 * It runs no build, no network and no model/DB operation; its result is always
 * OBSERVED_ONLY with paidExecutionAuthorized=false.
 */
export async function observeI111BuildArtifacts(rootPath) {
  try {
    if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) fail();
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory()) fail();
    const root = await realpath(rootPath);
    if (root !== resolve(rootPath)) fail();
    const head = git(root, ['rev-parse', '--verify', 'HEAD']);
    const tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']);
    if (!HEX40.test(head) || !HEX40.test(tree)) fail();
    if (
      git(root, [
        'status',
        '--porcelain=v1',
        '--untracked-files=no',
        '--ignore-submodules=none',
      ]) !== ''
    )
      fail();
    git(root, ['diff', '--no-ext-diff', '--quiet', 'HEAD', '--']);

    const source = [];
    for (const path of I111_BUILD_SOURCE_FILES) {
      if (git(root, ['ls-files', '--error-unmatch', '--', path]) !== path) fail();
      source.push([path, await hashRegularFile(root, path)]);
    }
    const dist = [];
    for (const path of DIST_DIRS) await collectDist(root, path, dist);
    if (!dist.some(([path]) => path === 'apps/api/dist/picture-book/i111-source-bound-service.js'))
      fail();
    if (!dist.some(([path]) => path === 'apps/worker/dist/i111-source-bound-target.js')) fail();

    const observed = {
      schemaVersion: 1,
      head,
      tree,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      source,
      dist,
    };
    return Object.freeze({
      verdict: 'OBSERVED_ONLY',
      observationSha256: digest(JSON.stringify(observed)),
      ...observed,
      verifiedBuildProvenance: false,
      paidExecutionAuthorized: false,
    });
  } catch {
    return Object.freeze({
      verdict: 'STOP',
      errorCode: STOP,
      verifiedBuildProvenance: false,
      paidExecutionAuthorized: false,
    });
  }
}

/** Same observations on two independent builds are necessary, not sufficient. */
export function compareI111BuildObservations(first, second) {
  return Object.freeze({
    verdict:
      first?.verdict === 'OBSERVED_ONLY' &&
      second?.verdict === 'OBSERVED_ONLY' &&
      first.observationSha256 === second.observationSha256 &&
      first.head === second.head &&
      first.tree === second.tree
        ? 'MATCHING_OBSERVATIONS_ONLY'
        : 'STOP',
    verifiedBuildProvenance: false,
    paidExecutionAuthorized: false,
  });
}
