import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-check-main.sh', import.meta.url).pathname;
const current = 'a'.repeat(40);
const next = 'b'.repeat(40);

async function simulate({ expected = current, latest = current, failure = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-main-check-'));
  const outputPath = join(dir, 'output');
  const mockGit = join(dir, 'git');
  await writeFile(
    mockGit,
    '#!/bin/sh\n[ "$1" = "ls-remote" ] || exit 2\n[ "$MOCK_FAILURE" != 1 ] || exit 3\nprintf "%s\\trefs/heads/main\\n" "$MOCK_LATEST"\n',
  );
  await chmod(mockGit, 0o755);
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STAGING_CI_SHA: expected,
      GITHUB_OUTPUT: outputPath,
      MOCK_LATEST: latest,
      MOCK_FAILURE: failure ? '1' : '0',
    },
  });
  return { result, output: await readFile(outputPath, 'utf8').catch(() => '') };
}

test('latest main permits exact CI SHA', async () => {
  const { result, output } = await simulate();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output, 'current=true\n');
});

test('old main SHA is safely skipped', async () => {
  const { result, output } = await simulate({ latest: next });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output, 'current=false\n');
  assert.match(result.stdout, /STAGING_SKIP_SUPERSEDED/);
});

test('network errors and malformed SHAs fail closed', async () => {
  for (const options of [{ failure: true }, { expected: 'bad' }, { latest: 'invalid' }]) {
    const { result } = await simulate(options);
    assert.notEqual(result.status, 0);
  }
});
