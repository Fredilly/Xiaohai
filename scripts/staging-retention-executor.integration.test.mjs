import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  normalizeProposal,
  validateExecutionInputs,
  verifySourceDeployment,
} from './staging-retention-executor-lib.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const guardScript = new URL('./staging-retention-executor-lib.mjs', import.meta.url).pathname;
const dispatchScript = new URL('./staging-retention-dispatch.sh', import.meta.url).pathname;
const remoteScript = new URL('./staging-retention-remote-executor.sh', import.meta.url).pathname;

const revision = '1'.repeat(40);
const rollbackA = '2'.repeat(40);
const rollbackB = '3'.repeat(40);
const extraProtected = '4'.repeat(40);
const candidateA = '5'.repeat(40);
const candidateB = '6'.repeat(40);
const apiA = `sha256:${'a'.repeat(64)}`;
const workerA = `sha256:${'b'.repeat(64)}`;
const apiB = `sha256:${'c'.repeat(64)}`;
const workerB = `sha256:${'d'.repeat(64)}`;
let sequence = 10000;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function validInputs(overrides = {}) {
  return {
    masterEnabled: 'true',
    revision,
    sourceRunId: '42595913365',
    planSha256: 'a'.repeat(64),
    approvalId: 'XIAOHAI-195-STEADY-20261112-TEST1',
    policyId: 'XIAOHAI-195-RETENTION-V1',
    approvedPolicyId: 'XIAOHAI-195-RETENTION-V1',
    dispatchActor: 'lixia67',
    allowedActor: 'lixia67',
    rollbacks: `${rollbackA} ${rollbackB}`,
    extraProtected,
    configCoverage: 'true',
    expectedHostname: hostname(),
    ...overrides,
  };
}

function proposal(secondWorker = workerB) {
  return [
    `PLAN revision=${candidateA} api_id=${apiA} worker_id=${workerA}`,
    `PLAN revision=${candidateB} api_id=${apiB} worker_id=${secondWorker}`,
    'PLAN maximum_two_pairs=true',
    'PLAN COMPLETE mode=--plan proposed_pairs=2 deleted_pairs=0 approval_status=NOT_GRANTED',
    '',
  ].join('\n');
}

function mockGithub({
  sourceRevision = revision,
  sourceConclusion = 'success',
  mainRevision = revision,
  latestSuccessfulRevision = revision,
} = {}) {
  return {
    rest: {
      actions: {
        getWorkflowRun: async () => ({
          data: {
            name: 'Deploy staging (after CI)',
            conclusion: sourceConclusion,
            head_sha: sourceRevision,
            head_branch: 'main',
          },
        }),
      },
      repos: {
        getBranch: async () => ({ data: { commit: { sha: mainRevision } } }),
        listDeployments: async () => ({
          data: [
            { id: 10, sha: latestSuccessfulRevision },
            { id: 9, sha: revision },
          ],
        }),
        listDeploymentStatuses: async ({ deployment_id }) => ({
          data: deployment_id === 10 || deployment_id === 9 ? [{ state: 'success' }] : [],
        }),
      },
    },
  };
}

async function lineCount(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function remoteFixture({
  approvalId = 'XIAOHAI-195-STEADY-20261112-REMOTE1',
  planText = `${candidateA} ${apiA} ${workerA}\n${candidateB} ${apiB} ${workerB}\n`,
  expectedScriptBlob = null,
} = {}) {
  sequence += 1;
  const home = await mkdtemp(join(tmpdir(), 'xiaohai-retention-remote-home-'));
  const deployDir = join(home, 'xiaohai-deploy');
  await mkdir(deployDir, { recursive: true });
  const calls = join(home, 'calls.log');
  const partial = join(home, 'partial.log');
  const planCopy = join(home, 'plan-copy.txt');
  const hostScript = join(deployDir, 'staging-image-retention.sh');
  await writeFile(
    hostScript,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'call\\n' >> "$MOCK_CALLS"
cat "$STAGING_RETENTION_APPROVED_PLAN" > "$MOCK_PLAN_COPY"
if [[ "\${MOCK_HOST_HEALTH_FAIL:-}" == true ]]; then
  echo 'STOP retention: API health non-200' >&2
  exit 1
fi
if [[ -n "\${MOCK_EXPECT_SECOND_WORKER:-}" ]]; then
  second_worker="$(awk 'NR==2 {print $3}' "$STAGING_RETENTION_APPROVED_PLAN")"
  [[ "$second_worker" == "$MOCK_EXPECT_SECOND_WORKER" ]] || {
    echo 'STOP retention: second image ID mismatch' >&2
    exit 1
  }
fi
if [[ "\${MOCK_PARTIAL_FAIL:-}" == true ]]; then
  printf 'removed-one\\n' >> "$MOCK_PARTIAL"
  echo 'STOP retention: Docker refused deletion' >&2
  exit 8
fi
if [[ "\${MOCK_SLEEP:-}" == true ]]; then
  sleep 0.3
fi
echo 'RETENTION COMPLETE mode=--steady-state-execute deleted_pairs=1'
`,
  );
  await chmod(hostScript, 0o755);
  const blob =
    expectedScriptBlob ??
    spawnSync('git', ['hash-object', hostScript], { encoding: 'utf8' }).stdout.trim();
  const normalizedHash = sha256(planText);
  const run = sequence;
  const paramsPath = `/tmp/xiaohai-retention-params-${process.pid}-${run}.txt`;
  const planPath = `/tmp/xiaohai-retention-plan-${process.pid}-${run}.txt`;
  const values = [
    revision,
    `${rollbackA} ${rollbackB}`,
    extraProtected,
    'true',
    hostname(),
    blob,
    approvalId,
    'XIAOHAI-195-RETENTION-V1',
    'e'.repeat(64),
    normalizedHash,
    '42595913365',
    'lixia67',
  ];
  await writeFile(paramsPath, `${values.join('\n')}\n`, { mode: 0o600 });
  await writeFile(planPath, planText, { mode: 0o600 });

  const env = {
    ...process.env,
    HOME: home,
    MOCK_CALLS: calls,
    MOCK_PARTIAL: partial,
    MOCK_PLAN_COPY: planCopy,
  };

  return {
    home,
    calls,
    partial,
    planCopy,
    paramsPath,
    planPath,
    approvalId,
    env,
    recreateTransport: async () => {
      sequence += 1;
      const nextParams = `/tmp/xiaohai-retention-params-${process.pid}-${sequence}.txt`;
      const nextPlan = `/tmp/xiaohai-retention-plan-${process.pid}-${sequence}.txt`;
      await writeFile(nextParams, `${values.join('\n')}\n`, { mode: 0o600 });
      await writeFile(nextPlan, planText, { mode: 0o600 });
      return { paramsPath: nextParams, planPath: nextPlan };
    },
    run: (overrides = {}, paths = { paramsPath, planPath }) =>
      spawnSync('bash', [remoteScript, paths.paramsPath, paths.planPath], {
        env: { ...env, ...overrides },
        encoding: 'utf8',
      }),
  };
}

test('executable input guard fails closed for disabled master gate and wrong actor/policy/approval', () => {
  for (const [field, value, expected] of [
    ['masterEnabled', 'false', /master gate is disabled/],
    ['dispatchActor', 'other-user', /not the designated retention operator/],
    ['policyId', 'XIAOHAI-195-RETENTION-OTHER', /policy ID mismatch/],
    ['approvalId', 'XIAOHAI-195-PHASED-OLD', /strict single-use approval ID/],
  ]) {
    assert.throws(() => validateExecutionInputs(validInputs({ [field]: value })), expected);
  }
});

test('workflow CLI rejects shell metacharacters, quotes and newlines before SSH', async () => {
  const marker = join(tmpdir(), `xiaohai-retention-injection-${process.pid}`);
  const payloads = [
    `XIAOHAI-195-RETENTION-V1';touch ${marker};#`,
    'XIAOHAI-195-RETENTION-V1\nSECOND=bad',
    'XIAOHAI-195-RETENTION-$(id)',
  ];
  for (const policyId of payloads) {
    const input = validInputs({ policyId, approvedPolicyId: policyId });
    const result = spawnSync('node', [guardScript, 'validate-env'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        STAGING_RETENTION_EXECUTION_ENABLED: input.masterEnabled,
        REVISION: input.revision,
        SOURCE_RUN_ID: input.sourceRunId,
        PLAN_SHA256: input.planSha256,
        APPROVAL_ID: input.approvalId,
        POLICY_ID: input.policyId,
        APPROVED_POLICY_ID: input.approvedPolicyId,
        DISPATCH_ACTOR: input.dispatchActor,
        ALLOWED_ACTOR: input.allowedActor,
        ROLLBACKS: input.rollbacks,
        EXTRA_PROTECTED: input.extraProtected,
        CONFIG_COVERAGE: input.configCoverage,
        EXPECTED_HOSTNAME: input.expectedHostname,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid recurring retention policy ID/);
  }
  await assert.rejects(stat(marker));
});

test('mock GitHub verification rejects stale main and superseded backend success', async () => {
  await assert.rejects(
    verifySourceDeployment({
      github: mockGithub({ mainRevision: '9'.repeat(40) }),
      owner: 'Fredilly',
      repo: 'Xiaohai',
      revision,
      sourceRunId: '42595913365',
    }),
    /stale or superseded/,
  );
  await assert.rejects(
    verifySourceDeployment({
      github: mockGithub({ latestSuccessfulRevision: '8'.repeat(40) }),
      owner: 'Fredilly',
      repo: 'Xiaohai',
      revision,
      sourceRunId: '42595913365',
    }),
    /not the latest verified successful/,
  );
  const ok = await verifySourceDeployment({
    github: mockGithub(),
    owner: 'Fredilly',
    repo: 'Xiaohai',
    revision,
    sourceRunId: '42595913365',
  });
  assert.equal(ok.revision, revision);
});

test('proposal binding rejects mismatched SHA and a changed second image ID', () => {
  const reviewed = proposal();
  const reviewedSha = sha256(reviewed);
  assert.throws(
    () => normalizeProposal({ text: reviewed, revision, expectedSha256: '0'.repeat(64) }),
    /SHA-256 mismatch/,
  );
  const tampered = proposal(`sha256:${'f'.repeat(64)}`);
  assert.throws(
    () => normalizeProposal({ text: tampered, revision, expectedSha256: reviewedSha }),
    /SHA-256 mismatch/,
  );
  const normalized = normalizeProposal({ text: reviewed, revision, expectedSha256: reviewedSha });
  assert.equal(normalized.candidateCount, 2);
  assert.match(normalized.normalizedText, new RegExp(workerB));
});

test('remote executor blocks host hash mismatch before invoking retention', async () => {
  const fx = await remoteFixture({ expectedScriptBlob: '0'.repeat(40) });
  const result = fx.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /host script hash differs/);
  assert.equal(await lineCount(fx.calls), 0);
});

test('remote executor treats host health refusal as consumed one-shot with no retry', async () => {
  const fx = await remoteFixture();
  const result = fx.run({ MOCK_HOST_HEALTH_FAIL: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API health non-200/);
  assert.equal(await lineCount(fx.calls), 1);
  const receipt = join(
    fx.home,
    'xiaohai-deploy',
    '.retention-authorizations',
    fx.approvalId,
    'receipt.txt',
  );
  assert.match(await readFile(receipt, 'utf8'), /execution_status=1/);
});

test('remote executor refuses changed second image ID and does not retry', async () => {
  const badSecond = `sha256:${'f'.repeat(64)}`;
  const fx = await remoteFixture({
    planText: `${candidateA} ${apiA} ${workerA}\n${candidateB} ${apiB} ${badSecond}\n`,
  });
  const result = fx.run({ MOCK_EXPECT_SECOND_WORKER: workerB });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /second image ID mismatch/);
  assert.equal(await lineCount(fx.calls), 1);
});

test('partial deletion refusal is returned once and never retried', async () => {
  const fx = await remoteFixture();
  const result = fx.run({ MOCK_PARTIAL_FAIL: 'true' });
  assert.equal(result.status, 8);
  assert.match(result.stderr, /Docker refused deletion/);
  assert.equal(await lineCount(fx.calls), 1);
  assert.equal(await lineCount(fx.partial), 1);
  assert.match(result.stdout, /RETENTION_EXECUTOR_NO_RETRY=true/);
});

test('reused approval ID is rejected before a second retention invocation', async () => {
  const fx = await remoteFixture();
  const first = fx.run();
  assert.equal(first.status, 0, first.stderr);
  const next = await fx.recreateTransport();
  const second = fx.run({}, next);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /approval ID already consumed/);
  assert.equal(await lineCount(fx.calls), 1);
});

test('concurrent dispatches atomically consume one approval ID', async () => {
  const fx = await remoteFixture({
    approvalId: 'XIAOHAI-195-STEADY-20261112-CONCURRENT',
  });
  const secondPaths = await fx.recreateTransport();
  const run = (paths) =>
    new Promise((resolve) => {
      const child = spawn('bash', [remoteScript, paths.paramsPath, paths.planPath], {
        env: { ...fx.env, MOCK_SLEEP: 'true' },
        encoding: 'utf8',
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  const results = await Promise.all([
    run({ paramsPath: fx.paramsPath, planPath: fx.planPath }),
    run(secondPaths),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort((a, b) => a - b),
    [0, 1],
  );
  assert.equal(await lineCount(fx.calls), 1);
  assert.ok(results.some((result) => /approval ID already consumed/.test(result.stderr)));
});

test('mock SSH dispatcher sends only generated paths in remote command, never parameter contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-retention-dispatch-'));
  const bin = join(dir, 'bin');
  await mkdir(bin);
  const scpLog = join(dir, 'scp.log');
  const sshLog = join(dir, 'ssh.log');
  const marker = join(dir, 'should-not-exist');
  const params = join(dir, 'params.txt');
  const plan = join(dir, 'plan.txt');
  await writeFile(
    params,
    `safe\nXIAOHAI-195-RETENTION-V1';touch ${marker};#\n`,
    { mode: 0o600 },
  );
  await writeFile(plan, `${candidateA} ${apiA} ${workerA}\n`, { mode: 0o600 });
  await writeFile(
    join(bin, 'scp'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_SCP_LOG"
exit 0
`,
  );
  await chmod(join(bin, 'scp'), 0o755);
  await writeFile(
    join(bin, 'ssh'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_SSH_LOG"
cat >/dev/null
exit 0
`,
  );
  await chmod(join(bin, 'ssh'), 0o755);

  const result = spawnSync('bash', [dispatchScript, params, plan], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOST: 'staging.example',
      USER: 'admin',
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '2',
      MOCK_SCP_LOG: scpLog,
      MOCK_SSH_LOG: sshLog,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const sshCommand = await readFile(sshLog, 'utf8');
  assert.match(
    sshCommand,
    /bash -s -- '\/tmp\/xiaohai-retention-params-12345-2\.txt' '\/tmp\/xiaohai-retention-plan-12345-2\.txt'/,
  );
  assert.doesNotMatch(sshCommand, /RETENTION-V1|touch|should-not-exist/);
  await assert.rejects(stat(marker));
  await rm(dir, { recursive: true, force: true });
});
