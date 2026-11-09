import assert from 'node:assert/strict';
import test from 'node:test';
import {
  oneSuccessfulDailyDeploy,
  protectedRevisions,
  simulatedFootprint,
  assessSteadyStateRetention,
} from './staging-retention-model.mjs';


const OLD_SIZE = 500_000_000;
function initial() {
  const releases = Array.from({ length: 26 }, (_, day) => ({
    rev: 'old-' + day,
    day: day - 26,
    layers: [
      { id: 'legacy-base-api', bytes: 50_000_000 },
      { id: 'legacy-base-worker', bytes: 50_000_000 },
      { id: 'api-old-' + day, bytes: OLD_SIZE },
      { id: 'worker-old-' + day, bytes: OLD_SIZE },
    ],
  }));
  // Six fixed historical/HOLD releases, plus sliding current + two rollback.
  const holds = new Set(releases.slice(0, 6).map((r) => r.rev));
  const referenced = new Set();
  return { releases, holds, referenced, lastDay: 0 };
}

test('90 successful daily deployments converge to bounded live+rollback+holds storage', () => {
  let s = initial();
  const footprints = [];
  const counts = [];
  for (let day = 1; day <= 90; day++) {
    s = oneSuccessfulDailyDeploy(s, day);
    footprints.push(s.bytes);
    counts.push(s.releases.length);
    assert.ok(s.deleted.length <= 2);
    for (const rev of s.holds) assert.ok(s.releases.some((r) => r.rev === rev));
  }
  assert.ok(Math.max(...counts.slice(35)) <= 9, JSON.stringify(counts.slice(-8)));
  assert.equal(
    new Set(footprints.slice(35)).size,
    1,
    'shared-layer accounted footprint plateaus after backlog drains',
  );
  assert.ok(footprints.at(-1) < footprints[0]);
});

test('stopped container refs are protected even when obsolete', () => {
  let s = initial();
  s.referenced.add('old-12');
  for (let day = 1; day <= 60; day++) s = oneSuccessfulDailyDeploy(s, day);
  assert.ok(s.releases.some((r) => r.rev === 'old-12'));
  assert.ok(s.releases.length <= 10);
});

test('negative: stale deployment, excessive batch, inconsistent shared layer sizes fail closed', () => {
  let s = initial();
  s = oneSuccessfulDailyDeploy(s, 1);
  assert.throws(() => oneSuccessfulDailyDeploy(s, 1), /stale/);
  assert.throws(() => oneSuccessfulDailyDeploy(s, 2, { maxPairs: 3 }), /batch/);
  assert.throws(
    () =>
      simulatedFootprint([
        { layers: [{ id: 'shared', bytes: 2 }] },
        { layers: [{ id: 'shared', bytes: 3 }] },
      ]),
    /inconsistent/,
  );
  assert.equal(protectedRevisions(s.releases, s.holds).size, 9);
});

test('steady-state retention contract fails closed for missing proof or authorization', () => {
  const required = [
    'verifiedSuccessfulBackendDeployment',
    'verifiedBaselineAndGhcrDigests',
    'verifiedCurrentAndTwoRollbackPairs',
    'verifiedExtraAndFiveHolds',
    'independentSnapshotAndRestoreAccess',
    'approvedExactCandidateIds',
    'completeReferencesAndAliasCoverage',
    'fiveServicesAndFourVolumesHealthy',
    'correctHostAndExclusiveLock',
    'independentHumanReview',
    'ownerApprovedRetentionPolicy',
    'separateOperationalAuthorization',
    'noContainerdReclaimPending',
  ];
  const empty = assessSteadyStateRetention({});
  assert.equal(empty.stage, 'BLOCKED');
  assert.deepEqual(empty.missing, required);
  assert.equal(empty.dockerDeletionAuthorized, false);

  const all = Object.fromEntries(required.map((gate) => [gate, true]));
  for (const gate of required) {
    const blocked = assessSteadyStateRetention({ ...all, [gate]: false });
    assert.equal(blocked.stage, 'BLOCKED', gate);
    assert.deepEqual(blocked.missing, [gate]);
    assert.equal(blocked.dockerDeletionAuthorized, false);
  }
  const readyForSeparateReview = assessSteadyStateRetention(all);
  assert.equal(readyForSeparateReview.stage, 'REVIEW_COMPLETE_EXECUTION_STILL_SEPARATE');
  assert.deepEqual(readyForSeparateReview.missing, []);
  assert.equal(readyForSeparateReview.dockerDeletionAuthorized, false);
});

test('steady-state retention contract rejects assertions that are not literal true', () => {
  const inputs = [null, undefined, [], 'true', 1, { independentHumanReview: 'true' }];
  for (const input of inputs) {
    const verdict = assessSteadyStateRetention(input);
    assert.equal(verdict.stage, 'BLOCKED');
    assert.equal(verdict.dockerDeletionAuthorized, false);
  }
});
