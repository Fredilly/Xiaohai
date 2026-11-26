import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-web-verify.sh', import.meta.url).pathname;
const sha = 'a'.repeat(40);

async function fixture({ missing, wrongMarker, badLink, symlinkInRelease, brokenCompose } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'xiaohai-web-verify-'));
  await writeFile(join(cwd, 'staging.compose.yml'), 'services: {}\n');
  await writeFile(join(cwd, 'staging.env'), 'POSTGRES_DB=fixture\n');
  await writeFile(join(cwd, 'staging-web.compose.yml'), 'services: {}\n');
  await writeFile(join(cwd, 'staging-web.Caddyfile'), 'fixture\n');
  await writeFile(join(cwd, 'events'), '');
  await writeFile(
    join(cwd, 'docker'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$MOCK_EVENTS"\n[ "$MOCK_COMPOSE_FAIL" != 1 ]\n`,
  );
  await chmod(join(cwd, 'docker'), 0o755);
  for (const site of ['store', 'admin']) {
    if (missing === site) continue;
    const releases = join(cwd, 'web', site, 'releases');
    const dir = join(releases, sha);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), '<html>test</html>\n');
    await writeFile(
      join(dir, '.xiaohai-release-revision'),
      wrongMarker === site ? 'b'.repeat(40) : sha,
    );
    if (symlinkInRelease === site) await symlink('/etc/passwd', join(dir, 'escape.txt'));
    await symlink(
      badLink === site ? '/tmp/unsafe' : `releases/${sha}`,
      join(cwd, 'web', site, 'current'),
    );
  }
  return {
    cwd,
    run: (env = {}) =>
      spawnSync('bash', [script], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${cwd}:${process.env.PATH}`,
          MOCK_EVENTS: join(cwd, 'events'),
          MOCK_COMPOSE_FAIL: brokenCompose ? '1' : '0',
          STAGING_WEB_ENABLED: 'true',
          STAGING_WEB_RELEASE_SHA: sha,
          ...env,
        },
      }),
  };
}

test('both approved immutable releases and effective Compose pass', async () => {
  const fx = await fixture();
  const result = fx.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STAGING_WEB_VERIFIED overlay=base\+web/u);
  assert.match(await readFile(join(fx.cwd, 'events'), 'utf8'), /compose .* config --quiet/u);
});

test('explicit activation and valid exact approved SHA are mandatory', async () => {
  const fx = await fixture();
  for (const env of [
    { STAGING_WEB_ENABLED: 'false' },
    { STAGING_WEB_RELEASE_SHA: 'unapproved' },
    { STAGING_WEB_RELEASE_SHA: '' },
  ]) {
    const r = fx.run(env);
    assert.notEqual(r.status, 0);
  }
  assert.equal(await readFile(join(fx.cwd, 'events'), 'utf8'), '');
});

for (const [name, opt] of [
  ['missing admin release', { missing: 'admin' }],
  ['mismatched store SHA', { wrongMarker: 'store' }],
  ['absolute or escaping current symlink', { badLink: 'store' }],
  ['symlink inside approved release', { symlinkInRelease: 'admin' }],
]) {
  test(`${name} fails closed before Compose`, async () => {
    const fx = await fixture(opt);
    const r = fx.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /STAGING_WEB_STOP/u);
    assert.equal(await readFile(join(fx.cwd, 'events'), 'utf8'), '');
  });
}

test('invalid Compose configuration fails closed', async () => {
  const fx = await fixture({ brokenCompose: true });
  assert.notEqual(fx.run().status, 0);
});
