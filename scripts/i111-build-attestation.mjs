import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const STOP = 'I111_BUILD_ATTESTATION_STOP';
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 20_000_000;
const OBSERVATION_KEYS = Object.freeze([
  'verdict',
  'observationSha256',
  'schemaVersion',
  'head',
  'tree',
  'nodeVersion',
  'platform',
  'architecture',
  'source',
  'dist',
  'verifiedBuildProvenance',
  'paidExecutionAuthorized',
]);

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
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 64_000,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/nonexistent',
      LC_ALL: 'C',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.error || result.status !== 0 || result.stderr) fail();
  return result.stdout.trim();
}

function checkedGitState(root) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  const tree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (!HEX40.test(head) || !HEX40.test(tree)) fail();
  if (
    git(root, ['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none']) !==
    ''
  )
    fail();
  git(root, ['diff', '--no-ext-diff', '--quiet', 'HEAD', '--']);
  return { head, tree };
}

function ownDataFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) fail();
  for (const key of keys) {
    if (!Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value')) fail();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function expectedIdentity(value) {
  const expected = ownDataFields(value, ['head', 'tree']);
  if (!HEX40.test(expected.head) || !HEX40.test(expected.tree)) fail();
  return expected;
}

function checkedPairs(value, kind) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) fail();
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) fail();
    const record = value[i];
    if (
      !Array.isArray(record) ||
      record.length !== 2 ||
      !Object.hasOwn(record, 0) ||
      !Object.hasOwn(record, 1)
    )
      fail();
    const [path, hash] = record;
    if (typeof path !== 'string' || typeof hash !== 'string' || !HEX64.test(hash)) fail();
    if (seen.has(path)) fail();
    seen.add(path);
    if (kind === 'source') {
      if (path !== I111_BUILD_SOURCE_FILES[i]) fail();
    } else {
      if (
        !DIST_DIRS.some((dir) => path.startsWith(`${dir}/`)) ||
        !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(path) ||
        path.split('/').some((part) => part === '..' || part === '.')
      )
        fail();
    }
    pairs.push([path, hash]);
  }
  if (kind === 'source' && pairs.length !== I111_BUILD_SOURCE_FILES.length) fail();
  if (kind === 'dist') {
    if (!seen.has('apps/api/dist/picture-book/i111-source-bound-service.js')) fail();
    if (!seen.has('apps/worker/dist/i111-source-bound-target.js')) fail();
  }
  return pairs;
}

function checkedObservation(value) {
  const record = ownDataFields(value, OBSERVATION_KEYS);
  if (
    record.verdict !== 'OBSERVED_ONLY' ||
    record.schemaVersion !== 1 ||
    record.verifiedBuildProvenance !== false ||
    record.paidExecutionAuthorized !== false ||
    !HEX64.test(record.observationSha256) ||
    !HEX40.test(record.head) ||
    !HEX40.test(record.tree) ||
    typeof record.nodeVersion !== 'string' ||
    !/^v\d+\.\d+\.\d+$/u.test(record.nodeVersion) ||
    typeof record.platform !== 'string' ||
    !/^[a-z0-9_-]{2,32}$/u.test(record.platform) ||
    typeof record.architecture !== 'string' ||
    !/^[a-z0-9_-]{2,32}$/u.test(record.architecture)
  )
    fail();
  const source = checkedPairs(record.source, 'source');
  const dist = checkedPairs(record.dist, 'dist');
  const fields = {
    schemaVersion: 1,
    head: record.head,
    tree: record.tree,
    nodeVersion: record.nodeVersion,
    platform: record.platform,
    architecture: record.architecture,
    source,
    dist,
  };
  if (digest(JSON.stringify(fields)) !== record.observationSha256) fail();
  return fields;
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

async function collectBuildFiles(root) {
  const source = [];
  for (const path of I111_BUILD_SOURCE_FILES) {
    if (git(root, ['ls-files', '--error-unmatch', '--', path]) !== path) fail();
    source.push([path, await hashRegularFile(root, path)]);
  }
  const dist = [];
  for (const path of DIST_DIRS) await collectDist(root, path, dist);
  return { source, dist };
}

/**
 * Read-only build observations for an INDEPENDENT later review. This function
 * DOES NOT establish build provenance or approve a paid operation. In
 * particular, a manifest can be forged or produced from stale dist bytes.
 * It runs no build, no network and no model/DB operation; its result is always
 * OBSERVED_ONLY with paidExecutionAuthorized=false.
 */
export async function observeI111BuildArtifacts(rootPath, expectedHeadAndTree) {
  try {
    if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) fail();
    const expected = expectedIdentity(expectedHeadAndTree);
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory()) fail();
    const root = await realpath(rootPath);
    if (root !== resolve(rootPath)) fail();
    const { head, tree } = checkedGitState(root);
    if (head !== expected.head || tree !== expected.tree) fail();

    const first = await collectBuildFiles(root);
    const second = await collectBuildFiles(root);
    if (JSON.stringify(first) !== JSON.stringify(second)) fail();
    const { source, dist } = second;
    const after = checkedGitState(root);
    if (after.head !== head || after.tree !== tree) fail();
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
  try {
    const checkedFirst = checkedObservation(first);
    const checkedSecond = checkedObservation(second);
    return Object.freeze({
      verdict:
        JSON.stringify(checkedFirst) === JSON.stringify(checkedSecond)
          ? 'MATCHING_OBSERVATIONS_ONLY'
          : 'STOP',
      verifiedBuildProvenance: false,
      paidExecutionAuthorized: false,
    });
  } catch {
    return Object.freeze({
      verdict: 'STOP',
      verifiedBuildProvenance: false,
      paidExecutionAuthorized: false,
    });
  }
}
