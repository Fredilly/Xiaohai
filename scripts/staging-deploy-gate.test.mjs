import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/staging-deploy.yml', import.meta.url),
  'utf8',
);

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
  assert.equal(usages, 4, 'build checkout, image tag, deploy checkout and revision must match');
  assert.doesNotMatch(workflow, /\|\|\s*github\.sha/u);
});
