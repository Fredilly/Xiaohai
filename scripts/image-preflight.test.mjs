import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findStaleBuilds } from './image-preflight.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xiaohai-image-preflight-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'dist', 'index.js'), 'export const value = 1;\n');
  return {
    root,
    target: [{ label: 'fixture', source: 'src', output: 'dist/index.js' }],
  };
}

test('image preflight accepts a build newer than its sources', async () => {
  const { root, target } = await fixture();
  const old = new Date('2026-01-01T00:00:00Z');
  const fresh = new Date('2026-01-01T00:01:00Z');
  await utimes(join(root, 'src', 'index.ts'), old, old);
  await utimes(join(root, 'dist', 'index.js'), fresh, fresh);

  assert.deepEqual(await findStaleBuilds(root, target), []);
});

test('image preflight rejects stale or missing build outputs', async () => {
  const { root, target } = await fixture();
  const old = new Date('2026-01-01T00:00:00Z');
  const fresh = new Date('2026-01-01T00:01:00Z');
  await utimes(join(root, 'dist', 'index.js'), old, old);
  await utimes(join(root, 'src', 'index.ts'), fresh, fresh);

  assert.deepEqual(await findStaleBuilds(root, target), [
    { label: 'fixture', reason: 'STALE_BUILD', output: 'dist/index.js' },
  ]);

  const missingTarget = [{ label: 'missing', source: 'src', output: 'dist/missing.js' }];
  assert.deepEqual(await findStaleBuilds(root, missingTarget), [
    { label: 'missing', reason: 'MISSING_BUILD', output: 'dist/missing.js' },
  ]);
});
