import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-remote-deploy.sh', import.meta.url).pathname;
const revision = 'e38a1796b7f6eb08a7b10932567c5b781eed606c';

async function fixture({
  gateFailure = false,
  loginFailure = false,
  pullFailure = false,
  upFailure = false,
  lockFailure = false,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-auth-guard-'));
  const events = join(dir, 'events.log');
  const configPathFile = join(dir, 'config-path');
  await writeFile(events, '');
  await writeFile(join(dir, 'staging.env'), 'APP_ENV=staging\n');
  await writeFile(join(dir, 'staging.compose.yml'), 'services: {}\n');
  await writeFile(join(dir, 'revision.env'), 'REVISION=old\n');
  const gate = join(dir, 'staging-disk-gate.sh');
  await writeFile(
    gate,
    '#!/bin/sh\necho gate >> "$MOCK_EVENTS"\n[ "$MOCK_GATE_FAILURE" != 1 ]\n',
  );
  await chmod(gate, 0o755);
  const docker = join(dir, 'docker');
  await writeFile(
    docker,
    `#!/bin/sh
case "$1" in
  context)
    echo default
    ;;
  login)
    echo login >> "$MOCK_EVENTS"
    test -n "$DOCKER_CONFIG" || exit 71
    printf '%s' "$DOCKER_CONFIG" > "$MOCK_CONFIG_PATH_FILE"
    cat > /dev/null
    printf '%s\\n' '{"auths": {"ghcr.io": {}}}' > "$DOCKER_CONFIG/config.json"
    [ "$MOCK_LOGIN_FAILURE" != 1 ] || exit 72
    ;;
  logout)
    echo logout >> "$MOCK_EVENTS"
    ;;
  compose)
    case " $* " in
      *" pull "*) echo pull >> "$MOCK_EVENTS"; [ "$MOCK_PULL_FAILURE" != 1 ] || exit 73 ;;
      *" up -d "*) echo up >> "$MOCK_EVENTS"; [ "$MOCK_UP_FAILURE" != 1 ] || exit 74 ;;
      *) exit 75 ;;
    esac
    ;;
  *) exit 76 ;;
esac
`,
  );
  await chmod(docker, 0o755);
  if (lockFailure) {
    const flock = join(dir, 'flock');
    await writeFile(flock, '#!/bin/sh\nexit 77\n');
    await chmod(flock, 0o755);
  }
  return {
    dir,
    events,
    configPathFile,
    run: () =>
      spawnSync('bash', [script], {
        cwd: dir,
        input: 'synthetic-token-never-log',
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          REVISION: revision,
          STAGING_DEPLOY_LOCK: join(dir, 'lock'),
          MOCK_EVENTS: events,
          MOCK_CONFIG_PATH_FILE: configPathFile,
          MOCK_GATE_FAILURE: gateFailure ? '1' : '0',
          MOCK_LOGIN_FAILURE: loginFailure ? '1' : '0',
          MOCK_PULL_FAILURE: pullFailure ? '1' : '0',
          MOCK_UP_FAILURE: upFailure ? '1' : '0',
        },
      }),
  };
}

async function assertCleaned(fx) {
  const config = await readFile(fx.configPathFile, 'utf8');
  await assert.rejects(stat(config), { code: 'ENOENT' });
}

test('failed disk gate refuses login and leaves revision file unchanged', async () => {
  const fx = await fixture({ gateFailure: true });
  const result = fx.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual((await readFile(fx.events, 'utf8')).trim().split('\n'), ['gate']);
  assert.equal(await readFile(join(fx.dir, 'revision.env'), 'utf8'), 'REVISION=old\n');
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token-never-log/u);
});

test('failed host lock blocks gate, login, and deployment', async () => {
  const fx = await fixture({ lockFailure: true });
  const result = fx.run();
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(fx.events, 'utf8'), '');
});

test('failed registry login still logs out and deletes isolated Docker credentials', async () => {
  const fx = await fixture({ loginFailure: true });
  const result = fx.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual((await readFile(fx.events, 'utf8')).trim().split('\n'), [
    'gate',
    'login',
    'logout',
  ]);
  await assertCleaned(fx);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token-never-log/u);
});

for (const [failure, expected] of [
  ['pullFailure', ['gate', 'login', 'pull', 'logout']],
  ['upFailure', ['gate', 'login', 'pull', 'up', 'logout']],
]) {
  test(`failed ${failure} always logs out and deletes Docker credentials`, async () => {
    const fx = await fixture({ [failure]: true });
    const result = fx.run();
    assert.notEqual(result.status, 0);
    assert.deepEqual((await readFile(fx.events, 'utf8')).trim().split('\n'), expected);
    await assertCleaned(fx);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token-never-log/u);
  });
}

test('successful deployment also cleans isolated registry credentials', async () => {
  const fx = await fixture();
  const result = fx.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(fx.events, 'utf8')).trim().split('\n'), [
    'gate',
    'login',
    'pull',
    'up',
    'logout',
  ]);
  assert.equal(
    await readFile(join(fx.dir, 'revision.env'), 'utf8'),
    `REVISION=${revision}\n`,
  );
  await assertCleaned(fx);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token-never-log/u);
});
