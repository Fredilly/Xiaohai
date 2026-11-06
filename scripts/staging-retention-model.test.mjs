import assert from 'node:assert/strict';
import test from 'node:test';
import {
  oneSuccessfulDailyDeploy,
  protectedRevisions,
  simulatedFootprint,
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
