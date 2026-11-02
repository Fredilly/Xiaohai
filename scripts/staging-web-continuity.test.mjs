import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-remote-deploy.sh', import.meta.url).pathname;
const revision = 'e'.repeat(40);
const release = 'a'.repeat(40);

async function fixture({
  active = false,
  pending = false,
  gateFailure = false,
  verifyFailure = false,
} = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'xiaohai-web-continuity-'));
  const events = join(cwd, 'events');
  await writeFile(events, '');
  await writeFile(join(cwd, 'staging.env'), 'APP_ENV=staging\n');
  await writeFile(join(cwd, 'staging.compose.yml'), 'services: {}\n');
  await writeFile(join(cwd, 'staging-web.compose.yml'), 'services: {}\n');
  await writeFile(join(cwd, 'revision.env'), 'REVISION=old\n');
  if (active || pending) {
    await writeFile(
      join(cwd, 'staging-web.active'),
      `WEB_STATE=${pending ? 'pending' : 'active'}\nWEB_ACTIVE_SHA=${release}\n`,
    );
  }
  await writeFile(
    join(cwd, 'staging-disk-gate.sh'),
    '#!/bin/sh\necho gate >> "$MOCK_EVENTS"\n[ "$MOCK_GATE_FAILURE" != 1 ]\n',
  );
  await chmod(join(cwd, 'staging-disk-gate.sh'), 0o755);
  await writeFile(
    join(cwd, 'staging-web-verify.sh'),
    '#!/bin/sh\necho verify >> "$MOCK_EVENTS"\n[ "$MOCK_VERIFY_FAILURE" != 1 ]\n',
  );
  await chmod(join(cwd, 'staging-web-verify.sh'), 0o755);
  await writeFile(
    join(cwd, 'docker'),
    `#!/bin/sh
case "$1" in
  context) echo default ;;
  login)
    echo login >> "$MOCK_EVENTS"
    test -n "$DOCKER_CONFIG" || exit 90
    cat > /dev/null
    echo '{}' > "$DOCKER_CONFIG/config.json"
    ;;
  logout) echo logout >> "$MOCK_EVENTS" ;;
  compose)
    case " $* " in
      *" pull "*) echo "pull:$*" >> "$MOCK_EVENTS" ;;
      *" up -d "*)
        echo "up:$*" >> "$MOCK_EVENTS"
        if [ "$MOCK_INTERRUPT_AFTER_UP" = 1 ]; then kill -KILL "$PPID"; exit 91; fi
        if [ "$MOCK_UP_FAILURE" = 1 ]; then exit 92; fi
        ;;
      *) exit 89 ;;
    esac
    ;;
  *) exit 88 ;;
esac
`,
  );
  await chmod(join(cwd, 'docker'), 0o755);
  await writeFile(
    join(cwd, 'sync'),
    `#!/bin/sh\necho sync >> "$MOCK_EVENTS"\n[ "$MOCK_SYNC_FAILURE" != 1 ]\n`,
  );
  await chmod(join(cwd, 'sync'), 0o755);
  return {
    cwd,
    events,
    run: (env = {}) =>
      spawnSync('bash', [script], {
        cwd,
        input: 'test-token-never-log',
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${cwd}:${process.env.PATH}`,
          MOCK_EVENTS: events,
          MOCK_GATE_FAILURE: gateFailure ? '1' : '0',
          MOCK_VERIFY_FAILURE: verifyFailure ? '1' : '0',
          MOCK_INTERRUPT_AFTER_UP: '0',
          MOCK_UP_FAILURE: '0',
          MOCK_SYNC_FAILURE: '0',
          REVISION: revision,
          STAGING_WEB_ENABLED: 'false',
          STAGING_WEB_RELEASE_SHA: release,
          STAGING_DEPLOY_LOCK: join(cwd, 'lock'),
          ...env,
        },
      }),
  };
}

test('default OFF preserves existing API-only deployment path', async () => {
  const fx = await fixture();
  const r = fx.run();
  assert.equal(r.status, 0, r.stderr);
  const events = await readFile(fx.events, 'utf8');
  assert.match(events, /pull:.* -f staging.compose.yml pull/u);
  assert.doesNotMatch(events, /staging-web.compose.yml|verify/u);
  assert.doesNotMatch(r.stdout + r.stderr, /test-token-never-log/u);
});

test('enabled overlay requires verification and preserves web files in both compose calls', async () => {
  const fx = await fixture();
  const r = fx.run({ STAGING_WEB_ENABLED: 'true' });
  assert.equal(r.status, 0, r.stderr);
  const events = await readFile(fx.events, 'utf8');
  assert.match(events, /gate\nverify\nlogin/u);
  assert.match(events, /pull:.*-f staging.compose.yml -f staging-web.compose.yml pull/u);
  assert.match(
    events,
    /up:.*-f staging.compose.yml -f staging-web.compose.yml up -d --remove-orphans/u,
  );
  assert.equal(
    await readFile(join(fx.cwd, 'staging-web.active'), 'utf8'),
    `WEB_STATE=active\nWEB_ACTIVE_SHA=${release}\n`,
  );
});

test('bad web release prevents registry login and leaves deployed revision untouched', async () => {
  const fx = await fixture({ verifyFailure: true });
  const r = fx.run({ STAGING_WEB_ENABLED: 'true' });
  assert.notEqual(r.status, 0);
  assert.equal(await readFile(fx.events, 'utf8'), 'gate\nverify\n');
  assert.equal(await readFile(join(fx.cwd, 'revision.env'), 'utf8'), 'REVISION=old\n');
});

test('enabled overlay respects disk gate before verification or login', async () => {
  const fx = await fixture({ gateFailure: true });
  assert.notEqual(fx.run({ STAGING_WEB_ENABLED: 'true' }).status, 0);
  assert.equal(await readFile(fx.events, 'utf8'), 'gate\n');
});

test('active site cannot be silently disabled by default OFF', async () => {
  const fx = await fixture({ active: true });
  const r = fx.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot silently revert/u);
  assert.equal(await readFile(fx.events, 'utf8'), '');
});

test('explicit deactivation is possible without deleting old web releases', async () => {
  const fx = await fixture({ active: true });
  const r = fx.run({ STAGING_WEB_DEACTIVATION_APPROVED: 'true' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    await readFile(fx.events, 'utf8').then((x) => x.includes('staging-web.compose.yml')),
    false,
  );
  assert.equal(
    await readFile(join(fx.cwd, 'staging-web.active'), 'utf8').then(
      () => true,
      () => false,
    ),
    false,
  );
});

test('existing pending guard blocks default OFF before capacity gate or login', async () => {
  const fx = await fixture({ pending: true });
  const result = fx.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pending or active web overlay cannot silently revert/u);
  assert.equal(await readFile(fx.events, 'utf8'), '');
});

test('interruption after Compose activation leaves pending and blocks next default OFF', async () => {
  const fx = await fixture();
  const interrupted = fx.run({ STAGING_WEB_ENABLED: 'true', MOCK_INTERRUPT_AFTER_UP: '1' });
  assert.notEqual(interrupted.status, 0);
  assert.equal(
    await readFile(join(fx.cwd, 'staging-web.active'), 'utf8'),
    `WEB_STATE=pending\nWEB_ACTIVE_SHA=${release}\n`,
  );
  const before = await readFile(fx.events, 'utf8');
  assert.match(before, /up:.*-f staging-web\.compose\.yml up -d/u);
  const resumed = fx.run();
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /pending or active web overlay cannot silently revert/u);
  assert.equal(await readFile(fx.events, 'utf8'), before);
});

test('failed enabled Compose up retains pending marker for owner reconciliation', async () => {
  const fx = await fixture();
  const failed = fx.run({ STAGING_WEB_ENABLED: 'true', MOCK_UP_FAILURE: '1' });
  assert.notEqual(failed.status, 0);
  assert.equal(
    await readFile(join(fx.cwd, 'staging-web.active'), 'utf8'),
    `WEB_STATE=pending\nWEB_ACTIVE_SHA=${release}\n`,
  );
  assert.notEqual(fx.run().status, 0);
});

test('guard persistence failure prevents activating Compose operation', async () => {
  const fx = await fixture();
  const result = fx.run({ STAGING_WEB_ENABLED: 'true', MOCK_SYNC_FAILURE: '1' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(await readFile(fx.events, 'utf8'), /^up:/mu);
});

test('approved deactivation can reconcile pending without deleting releases', async () => {
  const fx = await fixture({ pending: true });
  const result = fx.run({ STAGING_WEB_DEACTIVATION_APPROVED: 'true' });
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(readFile(join(fx.cwd, 'staging-web.active'), 'utf8'), { code: 'ENOENT' });
});
