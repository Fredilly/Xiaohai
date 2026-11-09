import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/staging-deploy.yml', import.meta.url),
  'utf8',
);
const remoteDeploy = await readFile(new URL('./staging-remote-deploy.sh', import.meta.url), 'utf8');

test('staging deploy is triggered only by completed CI runs on main', () => {
  const triggers = workflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1];
  assert.ok(triggers, 'workflow must declare its event triggers');
  const triggerNames = triggers
    .split('\n')
    .filter((line) => /^  [a-z_]+:/u.test(line))
    .map((line) => line.trim().split(':')[0]);
  assert.deepEqual(triggerNames, ['workflow_run']);
  assert.match(triggers, /workflows: \['CI'\]/u);
  assert.match(triggers, /types: \[completed\]/u);
  assert.match(triggers, /branches: \[main\]/u);
});

test('staging deploy rejects manual, PR and unsuccessful CI events', () => {
  const guard = workflow.match(
    /^  eligibility:\n[\s\S]*?    if: >-\n([\s\S]*?)^    runs-on:/m,
  )?.[1];
  assert.ok(guard, 'build job must have a mandatory execution guard');
  for (const condition of [
    "github.event_name == 'workflow_run'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
    "vars.STAGING_READY == 'true'",
  ]) {
    assert.ok(guard.includes(condition), `missing staging gate: ${condition}`);
  }
  assert.doesNotMatch(workflow, /workflow_dispatch/u);
});

test('both staging jobs use the exact CI-verified commit, never a fallback ref', () => {
  const pinnedRef = '${{ github.event.workflow_run.head_sha }}';
  const usages = workflow.split(pinnedRef).length - 1;
  assert.ok(usages >= 8, 'eligibility, build and deploy use pinned SHA');
  assert.doesNotMatch(workflow, /\|\|\s*github\.sha/u);
});

test('capacity gate and host lock run before registry login, revision switch and pull', () => {
  const lock = remoteDeploy.indexOf('flock -n 9');
  const gate = remoteDeploy.indexOf('bash staging-disk-gate.sh pre');
  const login = remoteDeploy.indexOf('docker login ghcr.io');
  const revisionWrite = remoteDeploy.indexOf('> revision.env');
  const pull = remoteDeploy.indexOf('staging.compose.yml pull');
  assert.ok(lock > 0 && lock < gate && gate < login && login < revisionWrite);
  assert.ok(revisionWrite < pull);
  assert.match(workflow, /scripts\/staging-remote-deploy\.sh/u);
  assert.match(workflow, /bash staging-remote-deploy\.sh/u);
  assert.match(workflow, /staging-disk-gate.sh post/u);
});

test('remote registry auth is isolated and always cleaned on exit', () => {
  const tempConfig = remoteDeploy.indexOf('mktemp -d');
  const trap = remoteDeploy.indexOf('trap cleanup EXIT');
  const login = remoteDeploy.indexOf('docker login ghcr.io');
  assert.ok(tempConfig > 0 && tempConfig < trap && trap < login);
  assert.match(remoteDeploy, /export DOCKER_CONFIG=/u);
  assert.match(remoteDeploy, /docker logout ghcr\.io/u);
  assert.match(remoteDeploy, /rm -f -- "\$docker_config\/config\.json"/u);
  assert.match(remoteDeploy, /rmdir -- "\$docker_config"/u);
  assert.match(workflow, /printf '%s' "\$GH_TOKEN" \| ssh/u);
  assert.doesNotMatch(workflow, /ssh[^\n]*docker login ghcr\.io/u);
});

test('retention remains opt-in dry run, not active deletion', () => {
  assert.match(workflow, /staging-image-retention.sh --dry-run/u);
  assert.doesNotMatch(workflow, /staging-image-retention.sh --execute/u);
  assert.match(workflow, /STAGING_RETENTION_PLAN_READY == 'true'/u);
  assert.match(workflow, /STAGING_EXTRA_PROTECTED_REVISION/u);
  assert.match(workflow, /STAGING_EXTRA_PROTECTED_REVISION='\$EXTRA_PROTECTED'/u);
  assert.match(workflow, /An explicit third historically protected revision is required/u);
  assert.match(workflow, /STAGING_CONFIG_COVERAGE_CONFIRMED/u);
  assert.match(
    workflow,
    /Deployment configuration scan coverage has not been independently verified/u,
  );
  assert.match(workflow, /STAGING_CONFIG_COVERAGE_CONFIRMED=true STAGING_CURRENT_REVISION/u);
});

test('outdated main CI is skipped before image build and again before staging SSH', () => {
  assert.match(workflow, /needs: eligibility/u);
  assert.match(workflow, /if: needs\.eligibility\.outputs\.current == 'true'/u);
  assert.match(workflow, /Recheck latest main before staging SSH/u);
  assert.match(workflow, /if: steps\.latest\.outputs\.current == 'true'/u);
  assert.match(workflow, /bash scripts\/staging-check-main\.sh/u);
  assert.match(
    workflow,
    /steps\.latest\.outputs\.current == 'true' && vars\.STAGING_RETENTION_PLAN_READY/u,
  );
});

test('post-success retention generates an opt-in exact-ID proposal and cannot delete', () => {
  const plan = workflow.match(/^  retention-plan:\n([\s\S]*)$/mu)?.[1];
  assert.ok(plan, 'explicit post-success retention-plan job required');
  assert.match(plan, /needs: \[eligibility, deploy\]/u);
  assert.match(plan, /needs\.deploy\.result == 'success'/u);
  assert.match(plan, /vars\.STAGING_RETENTION_PLAN_GENERATION_ENABLED == 'true'/u);
  assert.match(plan, /Recheck latest main before optional plan-only SSH/u);
  assert.match(plan, /staging-image-retention\.sh --plan/u);
  assert.match(plan, /actions\/upload-artifact@v4/u);
  assert.match(plan, /STAGING_CONFIG_COVERAGE_CONFIRMED=true/u);
  assert.match(plan, /STAGING_ROLLBACK_REVISIONS='\$ROLLBACKS'/u);
  assert.match(plan, /STAGING_EXTRA_PROTECTED_REVISION='\$EXTRA_PROTECTED'/u);
  assert.doesNotMatch(
    plan,
    /staging-image-retention\.sh --(?:execute|recovery-execute|steady-state-execute)/u,
  );
  assert.doesNotMatch(plan, /docker\s+(?:image\s+)?(?:rm|prune)/u);
  assert.doesNotMatch(plan, /STAGING_RETENTION_EXECUTE_ENABLED=true/u);
});

test('plan-only gate cannot run on a failed deployment or a stale CI revision', () => {
  assert.match(workflow, /needs\.deploy\.result == 'success'/u);
  assert.match(workflow, /needs\.eligibility\.outputs\.current == 'true'/u);
  assert.match(workflow, /bash scripts\/staging-check-main\.sh/u);
  assert.doesNotMatch(workflow, /workflow_dispatch/u);
});

test('UI-only merges are gated before any build, GHCR push, staging SSH or pull', () => {
  const eligibility = workflow.match(/^  eligibility:\n([\s\S]*?)^  build:/mu)?.[1];
  const build = workflow.match(/^  build:\n([\s\S]*?)^  deploy:/mu)?.[1];
  const deploy = workflow.match(/^  deploy:\n([\s\S]*?)^  retention-plan:/mu)?.[1];
  assert.ok(eligibility && build && deploy);
  assert.match(eligibility, /fetch-depth: 0/u);
  assert.match(eligibility, /Resolve last genuinely successful backend deployment/u);
  assert.match(eligibility, /staging-backend-success/u);
  assert.match(eligibility, /scripts\/staging-backend-gate\.mjs/u);
  assert.match(eligibility, /STAGING_MERGE_AUDIT/u);
  assert.match(build, /needs\.eligibility\.outputs\.backend_changed == 'true'/u);
  assert.match(deploy, /needs\.eligibility\.outputs\.backend_changed == 'true'/u);
  assert.match(build, /docker\/build-push-action@v6/u);
  assert.match(deploy, /staging-remote-deploy\.sh/u);
});

test('only fully successful backend deployments can advance the diff baseline', () => {
  const deploy = workflow.match(/^  deploy:\n([\s\S]*?)^  retention-plan:/mu)?.[1];
  const plan = workflow.match(/^  retention-plan:\n([\s\S]*?)^  record-backend-success:/mu)?.[1];
  const record = workflow.match(/^  record-backend-success:\n([\s\S]*)$/mu)?.[1];
  assert.ok(deploy && plan && record);
  assert.match(deploy, /id: deploy-images/u);
  assert.match(deploy, /staging-disk-gate\.sh post[\s\S]*?deployed=true/u);
  assert.match(plan, /needs\.deploy\.outputs\.deployed == 'true'/u);
  assert.match(record, /needs\.deploy\.outputs\.deployed == 'true'/u);
  assert.match(record, /needs\.retention-plan\.result == 'success'/u);
  assert.match(record, /createDeploymentStatus/u);
  assert.match(record, /state: 'success'/u);
  assert.match(record, /api_digest: api, worker_digest: worker/u);
  assert.match(record, /staging-backend-success/u);
  assert.doesNotMatch(record, /staging-image-retention\.sh --execute|docker\s+(?:image\s+)?rm/u);
});

test('PR #202 production-only Dockerfile remains selected by the gate', () => {
  assert.match(workflow, /file: deploy\/Dockerfile/u);
  assert.match(workflow, /staging-disk-gate\.sh post/u);
  assert.match(workflow, /Recheck latest main before staging SSH/u);
  assert.doesNotMatch(workflow, /docker\s+system\s+prune|down\s+-v/u);
});
