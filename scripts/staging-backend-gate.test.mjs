import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { classifyPaths, changedPaths, evaluate } from './staging-backend-gate.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'xiaohai-backend-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  const commit = (path, value = 'changed') => {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
    git('add', '-A');
    git('commit', '-qm', path);
    return git('rev-parse', 'HEAD');
  };
  const base = commit('README.md', 'baseline');
  return { dir, git, commit, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('four Nov 5 miniapp UI-only merges never build API or Worker images', () => {
  const f = fixture();
  try {
    const changes = [
      'apps/miniapp/pages/home/home.wxml',
      'apps/miniapp/pages/home/home.wxss',
      'apps/miniapp/assets/hero.png',
      'apps/miniapp/pages/home/home.ts',
    ];
    let head;
    for (const path of changes) head = f.commit(path);
    const result = evaluate({
      base: f.base,
      head,
      apiDigest: digest,
      workerDigest: digest,
      cwd: f.dir,
    });
    assert.equal(result.changed, false);
    assert.equal(result.paths.length, 4);
    assert.deepEqual(result.backend, []);
  } finally {
    f.cleanup();
  }
});

test('backend, runtime shared packages, locks and deployment config all trigger', () => {
  const paths = [
    'apps/api/src/server.ts',
    'apps/worker/src/index.ts',
    'packages/contracts/src/index.ts',
    'packages/db/migrations/0042.sql',
    'packages/config/src/index.ts',
    'packages/domain/src/index.ts',
    'packages/validation/src/index.ts',
    'pnpm-lock.yaml',
    'package.json',
    'deploy/Dockerfile',
    'deploy/staging.compose.yml',
    '.github/workflows/staging-deploy.yml',
    'scripts/staging-remote-deploy.sh',
    '.env.staging.example',
  ];
  for (const path of paths) {
    assert.equal(classifyPaths([path]).changed, true, path);
  }
});

test('mixed changes deploy, while frontend, docs, tests alone skip', () => {
  assert.equal(classifyPaths(['apps/miniapp/app.wxss', 'apps/api/src/server.ts']).changed, true);
  assert.equal(
    classifyPaths(['apps/store-web/src/App.tsx', 'docs/README.md', 'scripts/demo.test.mjs'])
      .changed,
    false,
  );
});

test('failed or skipped backend release followed by UI-only merge remains pending', () => {
  const f = fixture();
  try {
    const pending = f.commit('apps/worker/src/index.ts');
    const head = f.commit('apps/miniapp/pages/home/home.wxml');
    assert.equal(classifyPaths(changedPaths(pending, head, f.dir)).changed, false);
    assert.equal(
      evaluate({ base: f.base, head, apiDigest: digest, workerDigest: digest, cwd: f.dir }).changed,
      true,
      'the unchanged successful baseline must still see the pending worker change',
    );
  } finally {
    f.cleanup();
  }
});

test('renaming backend file to frontend cannot hide its deletion', () => {
  const f = fixture();
  try {
    const base = f.commit('apps/api/src/old.ts');
    mkdirSync(join(f.dir, 'apps/miniapp'), { recursive: true });
    f.git('mv', 'apps/api/src/old.ts', 'apps/miniapp/old.ts');
    f.git('commit', '-qm', 'move');
    const paths = changedPaths(base, f.git('rev-parse', 'HEAD'), f.dir);
    assert.ok(paths.includes('apps/api/src/old.ts'));
    assert.equal(classifyPaths(paths).changed, true);
  } finally {
    f.cleanup();
  }
});

test('unknown files, invalid digest, missing refs and errors fail closed', () => {
  assert.throws(() => classifyPaths(['unclassified/root.data']), /unclassified/u);
  assert.throws(() => classifyPaths(['apps/api/src/main.ts', 'unknown.file']), /unclassified/u);
  const f = fixture();
  try {
    assert.throws(
      () =>
        evaluate({ base: f.base, head: f.base, apiDigest: '', workerDigest: digest, cwd: f.dir }),
      /digests/u,
    );
    assert.throws(() => changedPaths('invalid', f.base, f.dir), /invalid baseline/u);
    assert.throws(() => changedPaths('c'.repeat(40), f.base, f.dir), /not an ancestor/u);
  } finally {
    f.cleanup();
  }
});
