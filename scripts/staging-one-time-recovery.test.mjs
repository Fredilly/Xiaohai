import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./staging-image-retention.sh', import.meta.url).pathname;
const current = 'e4c1117e99e1d739b002f99be3b97be7ede89121';
const rollbackA = 'f8e1fe86bbb904a4e7871901442a5b3dac7890e0';
const rollbackB = 'd79ca0ff400f52f05a140235565b9c981163ead5';
const extraProtected = 'b'.repeat(40);
const old = '1138ce2734533ae64e37eaccb2a833d9fa847515';
const oldB = '14d59d3cd209a400f397fdff1880b4f02ab26d54';
const extraOld = 'c'.repeat(40);
const recentHolds = [
  '03f5ee0f3d364597739162ca8661ebc993523ead',
  '12091f5d8586809ebb5d43308582797d00b3ba79',
  '662ca971de6cae265d810b7e37e74eb1ce836abc',
  'ecaea1f231469903e3eaa9dedad437f37d0d78c5',
  'ecc03badca74669d85f5c7b69915b81967d39825',
];
const heldId = (n) => `sha256:${n.toString(16).padStart(64, '0')}`;
const id = (n) => `sha256:${n.repeat(64)}`;
const api = (r) => `ghcr.io/fredilly/xiaohai-api:${r}`;
const worker = (r) => `ghcr.io/fredilly/xiaohai-worker:${r}`;
const recoveryIds = {
  [api(old)]: 'sha256:426eca170257042c73941d6920e0828304daa34020f86e3858f375b42b17ea2d',
  [worker(old)]: 'sha256:80f9bebe35e74e43da0cf49ca03f5abef8229ec179e600c0bbc1767ca9c00001',
  [api(oldB)]: 'sha256:7fcd05927e19fe566301516fdce1d3ab2297c8ef88b27454c16299d2e321fb96',
  [worker(oldB)]: 'sha256:9d2b3678ad02365397724f7ea1a57fac77e6654e45e57c3c0031314fb728fe7f',
};

async function fixture({
  ready = true,
  failRemove = null,
  workerRunning = true,
  missingHold = null,
  candidateMismatch = false,
  candidateMismatchB = false,
  selfSourceUnexpectedRef = false,
  otherConfigReference = false,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-exec-fixture-'));
  const deployDir = join(dir, 'xiaohai-deploy');
  await mkdir(deployDir);
  for (const file of [
    'revision.env',
    'staging.env',
    'staging.compose.yml',
    'Caddyfile',
    'staging-remote-deploy.sh',
    'staging-disk-gate.sh',
    'staging-image-retention.sh',
  ]) {
    let contents = '# fixture deployment config\\n';
    if (file === 'staging-image-retention.sh') {
      contents =
        `known_recovery_a=${old}\nknown_recovery_b=${oldB}\n` +
        (selfSourceUnexpectedRef ? `echo "${old}"\n` : '');
    }
    if (file === 'staging.compose.yml' && otherConfigReference) {
      contents += `# still deploying ${old}\n`;
    }
    await writeFile(join(deployDir, file), contents);
  }
  const statePath = join(dir, 'state.json');
  const images = Object.fromEntries([
    [api(current), id('1')],
    [worker(current), id('2')],
    [api(rollbackA), id('3')],
    [worker(rollbackA), id('4')],
    [api(rollbackB), id('5')],
    [worker(rollbackB), id('6')],
    [api(extraProtected), id('d')],
    [worker(extraProtected), id('e')],
    ['postgres:17-alpine', id('7')],
    ['redis:7.4-alpine', id('8')],
    ['caddy:2-alpine', id('9')],
    [api(old), candidateMismatch ? id('a') : recoveryIds[api(old)]],
    [worker(old), recoveryIds[worker(old)]],
    [api(oldB), recoveryIds[api(oldB)]],
    [worker(oldB), candidateMismatchB ? id('c') : recoveryIds[worker(oldB)]],
    [api(extraOld), id('a')],
    [worker(extraOld), id('b')],
    ...recentHolds.flatMap((rev, i) => [
      [api(rev), heldId(i + 1)],
      [worker(rev), heldId(i + 17)],
    ]),
  ]);
  if (missingHold) delete images[missingHold];
  await writeFile(statePath, JSON.stringify({ images, removed: [], failRemove, workerRunning }));
  const docker = join(dir, 'docker');
  await writeFile(
    docker,
    `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const p = process.env.MOCK_STATE;
const state = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = (value) => process.stdout.write(String(value) + '\\n');
if (a[0] === 'context' && a[1] === 'show') out('default');
else if (a[0] === 'image' && a[1] === 'ls') Object.keys(state.images).forEach(out);
else if (a[0] === 'image' && a[1] === 'inspect') {
  const ref = a[a.length - 1];
  if (!state.images[ref]) process.exit(1);
  if (a.includes('{{.Id}}')) out(state.images[ref]);
  else if (a.some(x => x.includes('RepoTags'))) out(ref);
  else process.exit(2);
} else if (a[0] === 'ps' && a[1] === '-aq') { out('running-api'); out('running-worker'); }
else if (a[0] === 'inspect') {
  const ref = a[a.length - 1];
  if (a.includes('{{.State.Health.Status}}')) out('healthy');
  else if (a.includes('{{.State.Running}}')) out(ref.includes('worker') && !state.workerRunning ? 'false' : 'true');
  else if (a.includes('{{.Config.Image}}')) out(ref.includes('api') ? process.env.MOCK_CURRENT_API : process.env.MOCK_CURRENT_WORKER);
  else if (a.includes('{{.Image}}')) out(ref.includes('api') ? state.images[process.env.MOCK_CURRENT_API] : state.images[process.env.MOCK_CURRENT_WORKER]);
  else process.exit(2);
} else if (a[0] === 'volume' && a[1] === 'inspect') out('[]');
else if (a[0] === 'exec' && a.includes('persistence')) {
  out('rdb_last_bgsave_status:ok\\r'); out('aof_last_write_status:ok\\r');
} else if (a[0] === 'image' && a[1] === 'rm') {
  const ref = a[a.length - 1];
  if (ref === state.failRemove) process.exit(8);
  if (!state.images[ref]) process.exit(1);
  delete state.images[ref];
  state.removed.push(ref);
  fs.writeFileSync(p, JSON.stringify(state));
  out('Deleted: ' + ref);
} else process.exit(2);
`,
  );
  await chmod(docker, 0o755);
  const grep = join(dir, 'grep');
  await writeFile(grep, '#!/bin/sh\n[ "$1" = "-RIlF" ] && exit 1\nexec /usr/bin/grep "$@"\n');
  await chmod(grep, 0o755);
  const sudo = join(dir, 'sudo');
  await writeFile(sudo, '#!/bin/sh\n[ "$1" = "-n" ] && shift\nexec "$@"\n');
  await chmod(sudo, 0o755);
  const curl = join(dir, 'curl');
  await writeFile(curl, `#!/bin/sh\nprintf '%s' '${ready ? '200' : '503'}'\n`);
  await chmod(curl, 0o755);
  const df = join(dir, 'df');
  await writeFile(
    df,
    `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE));
const removed = state.removed.length;
console.log('Filesystem 1024-blocks Used Available Capacity Mounted on');
console.log('/dev/vda3 51200000 100000  ' + (5000000 + removed * 600000) + ' ' + (80 - removed) + '% /');
`,
  );
  await chmod(df, 0o755);
  const plan = join(dir, 'approved-plan.txt');
  await writeFile(
    plan,
    `${old} ${recoveryIds[api(old)]} ${recoveryIds[worker(old)]}\n${oldB} ${recoveryIds[api(oldB)]} ${recoveryIds[worker(oldB)]}\n`,
  );
  const evidence = join(dir, 'owner-evidence.txt');
  await writeFile(
    evidence,
    'snapshot=s-j6ccgk5wyg44gmzqgf5v status=Success\n' +
      'workflow_run=41982285823 conclusion=failure reason=post_disk_gate\n' +
      'owner_approval=fixture-owner-approval\n',
  );
  const lock = join(dir, 'host.lock');
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    MOCK_STATE: statePath,
    MOCK_CURRENT_API: api(current),
    MOCK_CURRENT_WORKER: worker(current),
    STAGING_CURRENT_REVISION: current,
    STAGING_ROLLBACK_REVISIONS: `${rollbackA} ${rollbackB}`,
    STAGING_EXTRA_PROTECTED_REVISION: extraProtected,
    STAGING_DEPLOY_LOCK: lock,
    STAGING_DEPLOY_CONFIG_DIR: deployDir,
    STAGING_CONFIG_COVERAGE_CONFIRMED: 'true',
    STAGING_RETENTION_EXECUTE_ENABLED: 'true',
    STAGING_DEPLOY_SUCCEEDED_REVISION: '',
    STAGING_RECOVERY_EXECUTE_ENABLED: 'true',
    STAGING_RECOVERY_FAILED_RUN_ID: '41982285823',
    STAGING_RECOVERY_RUNTIME_ACCEPTED: 'true',
    STAGING_RECOVERY_EVIDENCE_FILE: evidence,
    STAGING_RETENTION_APPROVED_PLAN: plan,
    STAGING_RETENTION_APPROVAL_ID: 'fixture-owner-approval',
    STAGING_EXPECTED_HOSTNAME: hostname(),
  };
  return {
    lock,
    run: (mode = '--recovery-execute', overrides = {}) =>
      spawnSync('bash', [script, mode], {
        env: { ...env, ...overrides },
        encoding: 'utf8',
      }),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
    evidence,
    plan,
  };
}

test('one-time recovery keeps historic workflow failed and deletes only two exact approved pairs', async () => {
  const fx = await fixture();
  const result = fx.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /historic_workflow_conclusion=failure/);
  assert.match(result.stdout, /deleted_pairs=2/);
  const removed = (await fx.state()).removed;
  assert.deepEqual(removed, [api(old), worker(old), api(oldB), worker(oldB)]);
  assert.ok(!removed.includes(api(extraOld)));
  assert.ok(!removed.includes(worker(extraOld)));
  for (const rev of recentHolds) {
    assert.ok(!removed.includes(api(rev)));
    assert.ok(!removed.includes(worker(rev)));
  }
});

test('normal --execute still refuses historic failed release without successful deployment', async () => {
  const fx = await fixture();
  const r = fx.run('--execute');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /verified successful deployment revision is required/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('recovery defaults to disabled, independent of ordinary execution', async () => {
  const fx = await fixture();
  const r = fx.run('--recovery-execute', { STAGING_RECOVERY_EXECUTE_ENABLED: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /one-time recovery execution not enabled/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('recovery refuses to spoof successful workflow marker', async () => {
  const fx = await fixture();
  const r = fx.run('--recovery-execute', { STAGING_DEPLOY_SUCCEEDED_REVISION: current });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must not claim failed workflow was successful/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('recovery fails closed for wrong workflow, owner acceptance and snapshot evidence', async () => {
  for (const overrides of [
    { STAGING_RECOVERY_FAILED_RUN_ID: '123' },
    { STAGING_RECOVERY_RUNTIME_ACCEPTED: 'false' },
    { STAGING_RECOVERY_EVIDENCE_FILE: '/nonexistent' },
    { STAGING_RETENTION_APPROVAL_ID: 'unverified-owner' },
    { STAGING_CONFIG_COVERAGE_CONFIRMED: 'false' },
  ]) {
    const fx = await fixture();
    const r = fx.run('--recovery-execute', overrides);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual((await fx.state()).removed, []);
  }
});

test('wrong exact API image ID rejects recovery without deleting anything', async () => {
  const fx = await fixture({ candidateMismatch: true });
  const r = fx.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /recovery API image ID differs from owner allowlist/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('second recovery pair with wrong exact ID blocks first pair before any removal', async () => {
  const fx = await fixture({ candidateMismatchB: true });
  const r = fx.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /recovery Worker image ID differs from owner allowlist/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('unhealthy API, stopped Worker and missing protected HOLD all block recovery', async () => {
  for (const opts of [
    { ready: false },
    { workerRunning: false },
    { missingHold: api(recentHolds[0]) },
  ]) {
    const fx = await fixture(opts);
    const r = fx.run();
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual((await fx.state()).removed, []);
  }
});

test('exact pinned self-source declarations are not deployed references', async () => {
  const fx = await fixture();
  const r = fx.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual((await fx.state()).removed, [
    api(old),
    worker(old),
    api(oldB),
    worker(oldB),
  ]);
});

test('real source or Compose config references still block every removal', async () => {
  for (const opts of [{ selfSourceUnexpectedRef: true }, { otherConfigReference: true }]) {
    const fx = await fixture(opts);
    const result = fx.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /recovery deployment config still references old release/);
    assert.deepEqual((await fx.state()).removed, []);
  }
});

test('recovery refuses lock contention', async () => {
  const fx = await fixture();
  const holder = spawn('flock', ['-x', fx.lock, 'sleep', '3'], { stdio: 'ignore' });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = fx.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already running/);
    assert.deepEqual((await fx.state()).removed, []);
  } finally {
    holder.kill();
  }
});

test('steady-state mode requires genuinely successful latest deployment', async () => {
  const fx = await fixture();
  const bad = fx.run('--steady-state-execute');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /verified successful deployment revision is required/);
  assert.deepEqual((await fx.state()).removed, []);
});
