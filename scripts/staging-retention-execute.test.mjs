import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./staging-image-retention.sh', import.meta.url).pathname;
const executorWorkflow = new URL(
  '../.github/workflows/staging-retention-execute.yml',
  import.meta.url,
);
const remoteExecutor = new URL('./staging-retention-remote-executor.sh', import.meta.url).pathname;
const dispatchScript = new URL('./staging-retention-dispatch.sh', import.meta.url).pathname;
const current = 'e38a1796b7f6eb08a7b10932567c5b781eed606c';
const rollbackA = 'f8e1fe86bbb904a4e7871901442a5b3dac7890e0';
const rollbackB = 'd79ca0ff400f52f05a140235565b9c981163ead5';
const extraProtected = 'b'.repeat(40);
const old = 'c'.repeat(40);
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

async function fixture({
  ready = true,
  health = true,
  inodeHigh = false,
  lowDisk = false,
  gcDelayed = false,
  noReclaim = false,
  failRemove = null,
  workerRunning = true,
  missingHold = null,
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
    await writeFile(join(deployDir, file), '# fixture deployment config\\n');
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
    [api(old), id('a')],
    [worker(old), id('b')],
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
  await writeFile(
    curl,
    `#!/bin/sh
case "$*" in
  *"/health"*) printf '%s' '${health ? '200' : '503'}' ;;
  *) printf '%s' '${ready ? '200' : '503'}' ;;
esac
`,
  );
  await chmod(curl, 0o755);
  const df = join(dir, 'df');
  await writeFile(
    df,
    `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE));
const removed = state.removed.length;
console.log('Filesystem 1024-blocks Used Available Capacity Mounted on');
if (process.argv.includes('-Pi')) {
  console.log('/dev/vda3 51200000 100000  5000000 ${inodeHigh ? 86 : 70}% /');
} else {
  const reads = (state.diskReads || 0) + 1;
  state.diskReads = reads;
  fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
  const observedRemoved = ${noReclaim ? '0' : '(!' + gcDelayed + ' || reads > 3 ? removed : 0)'};
  console.log('/dev/vda3 51200000 100000  ' + (5000000 + observedRemoved * 600000) +
    ' ' + (${lowDisk ? 69 : 80} - observedRemoved) + '% /');
}
`,
  );
  await chmod(df, 0o755);
  // Avoid sleeping 50 real seconds in the slow-GC regression fixture.
  const sleep = join(dir, 'sleep');
  await writeFile(sleep, '#!/bin/sh\nexit 0\n');
  await chmod(sleep, 0o755);
  const plan = join(dir, 'approved-plan.txt');
  await writeFile(plan, `${old} ${id('a')} ${id('b')}\n`);
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
    STAGING_DEPLOY_SUCCEEDED_REVISION: current,
    STAGING_RETENTION_APPROVED_PLAN: plan,
    STAGING_RETENTION_APPROVAL_ID: 'fixture-owner-approval',
    STAGING_EXPECTED_HOSTNAME: hostname(),
  };
  return {
    lock,
    run: (mode = '--execute', overrides = {}) =>
      spawnSync('bash', [script, mode], {
        env: { ...env, ...overrides },
        encoding: 'utf8',
      }),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
  };
}

test('approved exact-ID execution checks services and stops after one pair', async () => {
  const fx = await fixture();
  const result = fx.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AUDIT deletion_completed=true/);
  assert.deepEqual((await fx.state()).removed, [api(old), worker(old)]);
  for (const rev of recentHolds) {
    assert.match(result.stdout, new RegExp(`PROTECTED_REVISION revision=${rev}`));
    assert.ok(!(await fx.state()).removed.includes(api(rev)));
    assert.ok(!(await fx.state()).removed.includes(worker(rev)));
  }
});

test('failed readiness blocks any removal', async () => {
  const fx = await fixture({ ready: false });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API readiness non-200/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('failed /health blocks removal even if /ready returns 200', async () => {
  const fx = await fixture({ health: false, ready: true });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API health non-200/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('inode emergency threshold blocks removal before first image', async () => {
  const fx = await fixture({ inodeHigh: true });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inode usage at or above emergency threshold/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('normal mode stops at safe capacity; steady-state may clean', async () => {
  const emergency = await fixture({ lowDisk: true });
  const result = emergency.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STOP target reached/);
  assert.deepEqual((await emergency.state()).removed, []);

  const steady = await fixture({ lowDisk: true });
  const completed = steady.run('--steady-state-execute');
  assert.equal(completed.status, 0, completed.stderr);
  assert.match(completed.stdout, /reclaimed_kib=1200000/);
  assert.match(completed.stdout, /inode_before_pct=70 inode_after_pct=70/);
  assert.deepEqual((await steady.state()).removed, [api(old), worker(old)]);
});

test('bounded GC observation tolerates delayed df updates, without manual prune', async () => {
  const fx = await fixture({ gcDelayed: true });
  const result = fx.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reclaimed_kib=1200000/);
  assert.deepEqual((await fx.state()).removed, [api(old), worker(old)]);
});

test('zero reclaimed space records deletion as complete but stops pending GC', async () => {
  const fx = await fixture({ noReclaim: true });
  const result = fx.run();
  assert.equal(result.status, 3);
  assert.match(result.stdout, /AUDIT deletion_completed=true/);
  assert.match(result.stdout, /RECLAIM_PENDING deletion_completed=true/);
  assert.doesNotMatch(result.stdout, /RETENTION COMPLETE/);
  assert.deepEqual((await fx.state()).removed, [api(old), worker(old)]);
});

test('plan-only produces exact-ID manifest without deletion or execution approvals', async () => {
  const fx = await fixture();
  const result = fx.run('--plan', {
    STAGING_RETENTION_EXECUTE_ENABLED: 'false',
    STAGING_RETENTION_APPROVED_PLAN: '/missing',
    STAGING_RETENTION_APPROVAL_ID: '',
    STAGING_DEPLOY_SUCCEEDED_REVISION: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`PLAN revision=${old} api_id=${id('a')} worker_id=${id('b')}`),
  );
  assert.match(result.stdout, /approval_status=NOT_GRANTED/);
  assert.match(result.stdout, /deleted_pairs=0/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('plan-only does not propose a protected HOLD release', async () => {
  const fx = await fixture();
  const result = fx.run('--plan');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROTECTED_REVISION revision=/);
  for (const rev of recentHolds) {
    assert.doesNotMatch(result.stdout, new RegExp(`PLAN revision=${rev}`));
  }
  assert.deepEqual((await fx.state()).removed, []);
});

test('plan-only refuses missing protected release or unhealthy application', async () => {
  for (const options of [{ missingHold: api(recentHolds[0]) }, { health: false }]) {
    const fx = await fixture(options);
    const result = fx.run('--plan');
    assert.equal(result.status, 1);
    assert.deepEqual((await fx.state()).removed, []);
  }
});

test('Docker failure stops without forced retry after partial removal', async () => {
  const fx = await fixture({ failRemove: worker(old) });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docker refused deletion/);
  assert.deepEqual((await fx.state()).removed, [api(old)]);
});

test('concurrent deployment lock stops retention without image changes', async () => {
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

test('stopped current Worker blocks removal even if API readiness passes', async () => {
  const fx = await fixture({ workerRunning: false });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /worker container is not running/);
  assert.deepEqual((await fx.state()).removed, []);
});

test('execute fails before any removal if a protected HOLD service image is missing', async () => {
  for (const ref of [api(recentHolds[0]), worker(recentHolds[4])]) {
    const fx = await fixture({ missingHold: ref });
    const r = fx.run();
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /protected image missing/);
    assert.deepEqual((await fx.state()).removed, []);
  }
});

test('steady-state executor workflow is manual, default-deny and owner-scoped', async () => {
  const source = await readFile(executorWorkflow, 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /STAGING_RETENTION_EXECUTION_ENABLED == 'true'/);
  assert.match(source, /STAGING_RETENTION_POLICY_ID/);
  assert.match(source, /STAGING_RETENTION_ALLOWED_ACTOR/);
  assert.match(source, /environment: staging/);
  assert.match(source, /\^XIAOHAI-195-STEADY-\[A-Za-z0-9-\]\+\$/);
  assert.doesNotMatch(source, /schedule:/);
});

test('steady-state executor binds exact successful deployment and reviewed proposal artifact', async () => {
  const source = await readFile(executorWorkflow, 'utf8');
  assert.match(source, /Deploy staging \(after CI\)/);
  assert.match(source, /staging-backend-success/);
  assert.match(source, /staging-retention-proposal-\$\{\{ inputs\.revision \}\}/);
  assert.match(source, /Reviewed proposal SHA-256 mismatch/);
  assert.match(source, /NORMALIZED_PLAN_SHA256/);
  assert.match(source, /uploaded normalized plan hash mismatch/);
  assert.match(source, /Proposal must contain one or two exact candidate pairs/);
  assert.match(source, /Current revision must never be a retention candidate/);
});

test('steady-state executor consumes approval before one bounded invocation and has no retry path', async () => {
  const workflow = await readFile(executorWorkflow, 'utf8');
  const remote = await readFile(remoteExecutor, 'utf8');
  const dispatch = await readFile(dispatchScript, 'utf8');
  assert.match(workflow, /staging-retention-dispatch\.sh/);
  assert.match(remote, /approval ID already consumed/);
  assert.match(remote, /\.retention-authorizations/);
  assert.match(remote, /mkdir -m 0700 "\$receipt_dir"/);
  assert.match(remote, /--steady-state-execute/);
  assert.match(remote, /RETENTION_EXECUTOR_NO_RETRY=true/);
  assert.match(remote, /STAGING_RETENTION_APPROVED_PLAN="\$plan"/);
  assert.match(remote, /STAGING_DEPLOY_SUCCEEDED_REVISION="\$REVISION"/);
  assert.match(remote, /STAGING_RETENTION_EXECUTE_ENABLED=true/);
  assert.doesNotMatch(dispatch, /POLICY_ID|APPROVAL_ID|REVISION=/);
  assert.doesNotMatch(workflow, /docker image rm/);
  assert.doesNotMatch(workflow, /docker (?:system|image) prune/);
});

test('steady-state executor preserves host identity, reviewed script and post-run health gates', async () => {
  const workflow = await readFile(executorWorkflow, 'utf8');
  const remote = await readFile(remoteExecutor, 'utf8');
  assert.match(remote, /host script hash differs from exact deployed revision/);
  assert.match(remote, /hostname mismatch/);
  assert.match(remote, /uploaded normalized plan hash mismatch/);
  assert.match(workflow, /docker inspect --format "\{\{\.State\.Health\.Status\}\}"/);
  assert.match(workflow, /staging-api\.pamboo\.asia\/health/);
  assert.match(workflow, /staging-api\.pamboo\.asia\/ready/);
  assert.match(workflow, /df -hT \/|df -hi \//);
});
