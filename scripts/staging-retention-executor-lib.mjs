import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const APPROVAL = /^XIAOHAI-195-STEADY-[A-Za-z0-9-]{1,80}$/;
const POLICY = /^XIAOHAI-195-RETENTION-[A-Za-z0-9-]{1,72}$/;
const ACTOR = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252}[A-Za-z0-9])?$/;

function requireMatch(value, pattern, message) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(message);
}

export function validateExecutionInputs(input) {
  if (input.masterEnabled !== 'true')
    throw new Error('Retention execution master gate is disabled.');
  requireMatch(input.revision, SHA40, 'Invalid exact revision.');
  requireMatch(input.sourceRunId, /^[1-9][0-9]*$/, 'Invalid source workflow run ID.');
  requireMatch(input.planSha256, SHA256, 'Invalid reviewed plan SHA-256.');
  requireMatch(
    input.approvalId,
    APPROVAL,
    'Steady-state execution requires a strict single-use approval ID.',
  );
  requireMatch(input.policyId, POLICY, 'Invalid recurring retention policy ID.');
  requireMatch(input.approvedPolicyId, POLICY, 'Approved retention policy ID is not configured.');
  if (input.policyId !== input.approvedPolicyId) {
    throw new Error('Owner-approved recurring retention policy ID mismatch.');
  }
  requireMatch(input.dispatchActor, ACTOR, 'Invalid workflow dispatch actor.');
  requireMatch(input.allowedActor, ACTOR, 'Designated retention operator is not configured.');
  if (input.dispatchActor !== input.allowedActor) {
    throw new Error('Workflow dispatch actor is not the designated retention operator.');
  }
  requireMatch(
    input.rollbacks,
    /^[0-9a-f]{40} [0-9a-f]{40}$/,
    'Exactly two verified rollback revisions are required.',
  );
  const [rollbackA, rollbackB] = input.rollbacks.split(' ');
  if (rollbackA === rollbackB || rollbackA === input.revision || rollbackB === input.revision) {
    throw new Error('Rollback revisions must be distinct from each other and current revision.');
  }
  requireMatch(
    input.extraProtected,
    SHA40,
    'One additional protected historical revision is required.',
  );
  if ([input.revision, rollbackA, rollbackB].includes(input.extraProtected)) {
    throw new Error(
      'Additional protected revision must be distinct from current and rollback revisions.',
    );
  }
  if (input.configCoverage !== 'true') {
    throw new Error('Deployment configuration coverage is not independently verified.');
  }
  requireMatch(
    input.expectedHostname,
    HOSTNAME,
    'Expected staging hostname is not configured safely.',
  );
  return {
    revision: input.revision,
    sourceRunId: input.sourceRunId,
    planSha256: input.planSha256,
    approvalId: input.approvalId,
    policyId: input.policyId,
    dispatchActor: input.dispatchActor,
    rollbacks: input.rollbacks,
    extraProtected: input.extraProtected,
    configCoverage: input.configCoverage,
    expectedHostname: input.expectedHostname,
  };
}

export async function verifySourceDeployment({ github, owner, repo, revision, sourceRunId }) {
  const source = await github.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: Number(sourceRunId),
  });
  const run = source.data;
  if (
    run.name !== 'Deploy staging (after CI)' ||
    run.conclusion !== 'success' ||
    run.head_sha !== revision ||
    run.head_branch !== 'main'
  ) {
    throw new Error(
      'Source run must be a successful Deploy staging (after CI) run for the exact revision.',
    );
  }

  const main = await github.rest.repos.getBranch({ owner, repo, branch: 'main' });
  if (main.data?.commit?.sha !== revision) {
    throw new Error('Retention revision is stale or superseded by current main.');
  }

  const deployments = await github.rest.repos.listDeployments({
    owner,
    repo,
    environment: 'staging-backend-success',
    per_page: 100,
  });
  let latestSuccessful = null;
  for (const entry of deployments.data) {
    const statuses = await github.rest.repos.listDeploymentStatuses({
      owner,
      repo,
      deployment_id: entry.id,
      per_page: 20,
    });
    if (statuses.data.some((status) => status.state === 'success')) {
      latestSuccessful = entry;
      break;
    }
  }
  if (!latestSuccessful || latestSuccessful.sha !== revision) {
    throw new Error(
      'Exact revision is not the latest verified successful staging backend deployment.',
    );
  }
  return { runId: Number(sourceRunId), revision };
}

export function normalizeProposal({ text, revision, expectedSha256 }) {
  requireMatch(revision, SHA40, 'Invalid exact revision.');
  requireMatch(expectedSha256, SHA256, 'Invalid reviewed plan SHA-256.');
  const actualSha256 = createHash('sha256').update(text).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error('Reviewed proposal SHA-256 mismatch.');

  const lines = text.split(/\r?\n/).filter((line) => line.startsWith('PLAN revision='));
  if (lines.length < 1 || lines.length > 2) {
    throw new Error('Proposal must contain one or two exact candidate pairs.');
  }

  const seen = new Set();
  const normalized = [];
  const pattern =
    /^PLAN revision=([0-9a-f]{40}) api_id=(sha256:[0-9a-f]{64}) worker_id=(sha256:[0-9a-f]{64})$/;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) throw new Error('Malformed exact-ID proposal line.');
    const [, candidate, apiId, workerId] = match;
    requireMatch(apiId, IMAGE_ID, 'Invalid API image ID.');
    requireMatch(workerId, IMAGE_ID, 'Invalid Worker image ID.');
    if (candidate === revision)
      throw new Error('Current revision must never be a retention candidate.');
    if (seen.has(candidate)) throw new Error('Duplicate candidate revision in proposal.');
    seen.add(candidate);
    normalized.push(`${candidate} ${apiId} ${workerId}`);
  }

  const completion = `PLAN COMPLETE mode=--plan proposed_pairs=${lines.length} deleted_pairs=0 approval_status=NOT_GRANTED`;
  if (!text.split(/\r?\n/).includes(completion)) {
    throw new Error('Proposal completion marker does not match exact candidate count.');
  }
  const normalizedText = `${normalized.join('\n')}\n`;
  return {
    actualSha256,
    candidateCount: lines.length,
    normalizedText,
    normalizedSha256: createHash('sha256').update(normalizedText).digest('hex'),
  };
}

if (process.argv[1]?.endsWith('staging-retention-executor-lib.mjs')) {
  const command = process.argv[2];
  try {
    if (command === 'validate-env') {
      validateExecutionInputs({
        masterEnabled: process.env.STAGING_RETENTION_EXECUTION_ENABLED,
        revision: process.env.REVISION,
        sourceRunId: process.env.SOURCE_RUN_ID,
        planSha256: process.env.PLAN_SHA256,
        approvalId: process.env.APPROVAL_ID,
        policyId: process.env.POLICY_ID,
        approvedPolicyId: process.env.APPROVED_POLICY_ID,
        dispatchActor: process.env.DISPATCH_ACTOR,
        allowedActor: process.env.ALLOWED_ACTOR,
        rollbacks: process.env.ROLLBACKS,
        extraProtected: process.env.EXTRA_PROTECTED,
        configCoverage: process.env.CONFIG_COVERAGE,
        expectedHostname: process.env.EXPECTED_HOSTNAME,
      });
      console.log('RETENTION_INPUT_GATES_PASS');
    } else if (command === 'normalize-env') {
      const proposalPath = process.env.PROPOSAL_PATH;
      const approvedPath = process.env.APPROVED_PATH;
      const githubEnv = process.env.GITHUB_ENV;
      if (!proposalPath || !approvedPath || !githubEnv) {
        throw new Error('Proposal normalization paths are not configured.');
      }
      const result = normalizeProposal({
        text: readFileSync(proposalPath, 'utf8'),
        revision: process.env.REVISION,
        expectedSha256: process.env.PLAN_SHA256,
      });
      writeFileSync(approvedPath, result.normalizedText, { mode: 0o600 });
      chmodSync(approvedPath, 0o600);
      appendFileSync(githubEnv, `NORMALIZED_PLAN_SHA256=${result.normalizedSha256}\n`);
      console.log(`NORMALIZED_CANDIDATE_PAIRS=${result.candidateCount}`);
    }
  } catch (error) {
    console.error(`RETENTION_EXECUTOR_STOP: ${error.message}`);
    process.exitCode = 1;
  }
}
