import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-disk-gate.sh', import.meta.url).pathname;

async function runGate({
  usage = 69,
  inode = 10,
  available = 10485760,
  mode = 'pre',
  minimum,
  growth,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-disk-gate-'));
  const df = join(dir, 'df');
  await writeFile(
    df,
    `#!/bin/sh\nif [ "$1" = '-Pi' ]; then\n  echo 'Filesystem Inodes IUsed IFree IUse% Mounted on'\n  echo '/dev/vda3 1000 ${inode * 10} ${1000 - inode * 10} ${inode}% /'\nelse\n  echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'\n  echo '/dev/vda3 51200000 1 ${available} ${usage}% /'\nfi\n`,
  );
  await chmod(df, 0o755);
  return spawnSync('bash', [script, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ...(minimum ? { STAGING_MIN_FREE_KIB: minimum } : {}),
      ...(growth !== undefined ? { STAGING_EXPECTED_IMAGE_PAIR_KIB: String(growth) } : {}),
    },
  });
}

test('70% disk usage warns without blocking deployment', async () => {
  const result = await runGate({ usage: 70 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARNING staging usage/);
});

test('85% disk or inode usage blocks deployment', async () => {
  for (const options of [{ usage: 85 }, { inode: 85 }]) {
    const result = await runGate(options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blocked/);
  }
});

test('insufficient image-pull headroom blocks pre, but post only reports it', async () => {
  const pre = await runGate({ available: 1024 });
  assert.equal(pre.status, 1);
  const post = await runGate({ available: 1024, mode: 'post' });
  assert.equal(post.status, 0);
});

test('invalid df data and unsafe minimum fail closed', async () => {
  assert.equal((await runGate({ usage: 101 })).status, 1);
  assert.equal((await runGate({ minimum: '-1' })).status, 2);
});

test('projected image growth blocks a nominal 84% pre-deploy crossing 85%', async () => {
  const pre = await runGate({ usage: 84, available: 8132712 });
  assert.equal(pre.status, 1);
  assert.match(pre.stderr, /projected disk usage >=85%/);
  assert.match(pre.stdout, /STAGING_DISK_FORECAST/);
  const post = await runGate({ usage: 84, available: 8132712, mode: 'post' });
  assert.equal(post.status, 0, post.stderr);
});

test('projected free headroom and zero growth fail closed', async () => {
  const low = await runGate({ usage: 77, available: 5242880 });
  assert.equal(low.status, 1);
  assert.match(low.stderr, /projected free space/);
  assert.equal((await runGate({ growth: 0 })).status, 2);
});
