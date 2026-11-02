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
  const guard = workflow.match(/^  build:\n    if: >-\n([\s\S]*?)^    runs-on:/m)?.[1];
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
  assert.equal(usages, 5, 'build and deploy use pinned SHA, including the optional audit');
  assert.doesNotMatch(workflow, /\|\|\s*github\.sha/u);
});

test('capacity gate and host lock run before registry login, revision switch and pull', () => {
  const lock = remoteDeploy.indexOf('flock -n 9');
  const gate = remoteDeploy.indexOf('bash staging-disk-gate.sh pre');
  const login = remoteDeploy.indexOf('docker login ghcr.io');
  const revisionWrite = remoteDeploy.indexOf('> revision.env');
  const pull = remoteDeploy.indexOf('"${compose_files[@]}" pull');
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

test('web activation is opt-in, sha pinned and protects later deployments', () => {
  assert.match(workflow, /STAGING_WEB_ENABLED: \$\{\{ vars\.STAGING_WEB_ENABLED \}\}/u);
  assert.match(workflow, /STAGING_WEB_RELEASE_SHA: \$\{\{ vars\.STAGING_WEB_RELEASE_SHA \}\}/u);
  assert.match(workflow, /staging-web-verify\.sh/u);
  assert.match(workflow, /staging-web\.compose\.yml/u);
  assert.match(remoteDeploy, /web_enabled="\$\{STAGING_WEB_ENABLED:-false\}"/u);
  assert.match(remoteDeploy, /compose_files\+=\(-f staging-web\.compose\.yml\)/u);
  assert.match(remoteDeploy, /web release or Compose overlay preflight failed/u);
  assert.match(remoteDeploy, /previously activated web overlay cannot silently revert/u);
  assert.match(remoteDeploy, /staging-web\.active/u);
  assert.doesNotMatch(workflow, /staging-web-verify\.sh --execute/u);
});
