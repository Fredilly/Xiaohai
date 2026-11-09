// Offline model only. NOT a live Docker cleanup implementation.
export function protectedRevisions(releases, holds) {
  const latest = [...releases]
    .sort((a, b) => b.day - a.day)
    .slice(0, 3)
    .map((x) => x.rev);
  return new Set([...holds, ...latest]);
}

export function simulatedFootprint(releases) {
  const unique = new Map();
  for (const release of releases) {
    for (const layer of release.layers) {
      if (unique.has(layer.id) && unique.get(layer.id) !== layer.bytes) {
        throw new Error('inconsistent layer-size accounting');
      }
      unique.set(layer.id, layer.bytes);
    }
  }
  return [...unique.values()].reduce((sum, n) => sum + n, 0);
}

export function oneSuccessfulDailyDeploy(state, day, { maxPairs = 2 } = {}) {
  if (!Number.isInteger(day) || day <= 0) throw new Error('invalid day');
  if (state.lastDay >= day) throw new Error('stale deployment');
  if (!Number.isInteger(maxPairs) || maxPairs < 0 || maxPairs > 2) {
    throw new Error('invalid batch limit');
  }
  const before = state.releases.map((r) => ({ ...r }));
  const added = {
    rev: 'daily-' + day,
    day,
    layers: [
      { id: 'api-base', bytes: 30_000_000 },
      { id: 'worker-base', bytes: 29_000_000 },
      { id: 'api-unique-' + day, bytes: 60_600_000 },
      { id: 'worker-unique-' + day, bytes: 57_700_000 },
    ],
  };
  const all = [...before, added];
  const protectedSet = protectedRevisions(all, state.holds);
  const removable = all
    .filter((r) => !protectedSet.has(r.rev) && !state.referenced.has(r.rev))
    .sort((a, b) => a.day - b.day)
    .slice(0, maxPairs);
  const remove = new Set(removable.map((r) => r.rev));
  const remaining = all.filter((r) => !remove.has(r.rev));
  if ([...protectedSet].some((rev) => !remaining.some((r) => r.rev === rev))) {
    throw new Error('protected release deleted');
  }
  return {
    holds: state.holds,
    referenced: state.referenced,
    releases: remaining,
    lastDay: day,
    deleted: removable.map((r) => r.rev),
    bytes: simulatedFootprint(remaining),
  };
}


/**
 * Code-only review contract for a future recurring retention executor.
 * This DOES NOT grant Docker deletion, install scripts, verify cloud evidence,
 * or replace the host script's exact image-ID approval mechanism.
 */
export const STEADY_STATE_REVIEW_GATES = Object.freeze([
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
]);

export function assessSteadyStateRetention(evidence) {
  const observations = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence
    : {};
  const missing = STEADY_STATE_REVIEW_GATES.filter((gate) => observations[gate] !== true);
  return {
    stage: missing.length ? 'BLOCKED' : 'REVIEW_COMPLETE_EXECUTION_STILL_SEPARATE',
    missing,
    // Intentionally never an execute permit: host-side independent proof,
    // owner-scoped authorization and a restricted executor are required.
    dockerDeletionAuthorized: false,
  };
}
