import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  I111_BUILD_SOURCE_FILES,
  compareI111BuildObservations,
  observeI111BuildArtifacts,
} from './i111-build-attestation.mjs';

const API_ENTRY = 'apps/api/dist/picture-book/i111-source-bound-service.js';
const WORKER_ENTRY = 'apps/worker/dist/i111-source-bound-target.js';

function git(root, args) {
  const command = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  return command.stdout.trim();
}

async function write(root, path, contents) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'i111-build-observation-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  for (const path of I111_BUILD_SOURCE_FILES) {
    await write(root, path, `fixture source: ${path}\n`);
  }
  await write(root, API_ENTRY, 'export const api = true;\n');
  await write(root, WORKER_ENTRY, 'export const worker = true;\n');
  await write(root, 'apps/api/dist/extra.json', '{"example":true}\n');
  git(root, ['add', '--', ...I111_BUILD_SOURCE_FILES]);
  git(root, [
    '-c',
    'user.name=I111 Test',
    '-c',
    'user.email=i111-test@example.invalid',
    'commit',
    '-qm',
    'test fixture',
  ]);
  return root;
}

function assertStopped(result) {
  assert.deepEqual(result, {
    verdict: 'STOP',
    errorCode: 'I111_BUILD_ATTESTATION_STOP',
    verifiedBuildProvenance: false,
    paidExecutionAuthorized: false,
  });
}

test('records checked-out source tree and every dist byte without claiming provenance', async (t) => {
  const root = await fixture(t);
  const first = await observeI111BuildArtifacts(root);
  const second = await observeI111BuildArtifacts(root);
  assert.equal(first.verdict, 'OBSERVED_ONLY');
  assert.equal(first.tree, git(root, ['rev-parse', 'HEAD^{tree}']));
  assert.equal(first.head, git(root, ['rev-parse', 'HEAD']));
  assert.equal(first.nodeVersion, process.version);
  assert.equal(first.source.length, I111_BUILD_SOURCE_FILES.length);
  assert.deepEqual(
    first.dist.map(([path]) => path).sort(),
    ['apps/api/dist/extra.json', API_ENTRY, WORKER_ENTRY].sort(),
  );
  assert.match(first.observationSha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.observationSha256, second.observationSha256);
  assert.deepEqual(compareI111BuildObservations(first, second), {
    verdict: 'MATCHING_OBSERVATIONS_ONLY',
    verifiedBuildProvenance: false,
    paidExecutionAuthorized: false,
  });
});

test('detects changed build output despite unchanged commit/tree', async (t) => {
  const root = await fixture(t);
  const original = await observeI111BuildArtifacts(root);
  await write(root, WORKER_ENTRY, 'export const worker = false;\n');
  const changed = await observeI111BuildArtifacts(root);
  assert.equal(changed.verdict, 'OBSERVED_ONLY');
  assert.equal(changed.tree, original.tree);
  assert.notEqual(changed.observationSha256, original.observationSha256);
  assert.equal(compareI111BuildObservations(original, changed).verdict, 'STOP');
});

test('fails closed on dirty tracked source, missing artifact and substituted symlink', async (t) => {
  const root = await fixture(t);
  await write(root, I111_BUILD_SOURCE_FILES[1], 'dirty lockfile\n');
  assertStopped(await observeI111BuildArtifacts(root));
  git(root, ['restore', '--', I111_BUILD_SOURCE_FILES[1]]);
  await rm(join(root, API_ENTRY));
  assertStopped(await observeI111BuildArtifacts(root));
  await write(root, API_ENTRY, 'restored\n');
  await rm(join(root, WORKER_ENTRY));
  await symlink(API_ENTRY, join(root, WORKER_ENTRY));
  assertStopped(await observeI111BuildArtifacts(root));
});

test('fails closed on missing tracked file, unknown directory and relative paths', async (t) => {
  const root = await fixture(t);
  const source = I111_BUILD_SOURCE_FILES.at(-1);
  await rm(join(root, source));
  assertStopped(await observeI111BuildArtifacts(root));
  assertStopped(await observeI111BuildArtifacts('relative/path'));
  const nonexistent = join(root, 'nonexistent');
  assertStopped(await observeI111BuildArtifacts(nonexistent));
});

test('rejects forged, incomplete or stopped observations for approval', async (t) => {
  const root = await fixture(t);
  const observed = await observeI111BuildArtifacts(root);
  assert.equal(compareI111BuildObservations({}, observed).verdict, 'STOP');
  assert.equal(
    compareI111BuildObservations(observed, { ...observed, tree: '0'.repeat(40) }).verdict,
    'STOP',
  );
  assert.equal(compareI111BuildObservations(observed, null).verdict, 'STOP');
  assert.equal(observed.verifiedBuildProvenance, false);
  assert.equal(observed.paidExecutionAuthorized, false);
  assert.equal((await readFile(join(root, WORKER_ENTRY), 'utf8')).length > 0, true);
});
