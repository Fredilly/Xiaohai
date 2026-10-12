const SCORE_FIELDS = [
  'faceIdentity',
  'clothing',
  'colors',
  'proportions',
  'artMediumStyle',
  'sceneContinuity',
  'promptAdherence',
];

export function validateQualityReview(artifact, { allowPending = false } = {}) {
  if (!artifact || artifact.fixtureId !== 'm10-two-character-two-page-v1') {
    throw new Error('unexpected quality fixture');
  }
  if (!Array.isArray(artifact.runs) || artifact.runs.length !== 3) {
    throw new Error('quality review must contain exactly 3 runs');
  }

  const expected = new Set(['page-1-original', 'page-2-original', 'page-2-regeneration']);
  const seen = new Set();

  for (const run of artifact.runs) {
    if (!expected.has(run.runId) || seen.has(run.runId)) {
      throw new Error(`invalid or duplicate run ${run.runId}`);
    }
    seen.add(run.runId);

    if (!allowPending) {
      for (const field of ['provider', 'model', 'success', 'accepted', 'generationLatencyMs']) {
        if (run[field] === null || run[field] === undefined) {
          throw new Error(`${run.runId} ${field} is missing`);
        }
      }
      for (const field of SCORE_FIELDS) {
        if (run.scores?.[field] === null || run.scores?.[field] === undefined) {
          throw new Error(`${run.runId} score ${field} is missing`);
        }
      }
      if (!run.unwantedTextArtifacts) {
        throw new Error(`${run.runId} unwantedTextArtifacts is missing`);
      }
    }

    for (const field of SCORE_FIELDS) {
      const value = run.scores?.[field];
      if (value !== null && value !== undefined) {
        if (typeof value !== 'number' || value < 1 || value > 5) {
          throw new Error(`${run.runId} score ${field} must be 1-5`);
        }
      }
    }

    if (
      run.generationLatencyMs !== null &&
      run.generationLatencyMs !== undefined &&
      (!Number.isFinite(run.generationLatencyMs) || run.generationLatencyMs < 0)
    ) {
      throw new Error(`${run.runId} generationLatencyMs is invalid`);
    }
    if (
      run.costMinor !== null &&
      run.costMinor !== undefined &&
      (!Number.isFinite(run.costMinor) || run.costMinor < 0)
    ) {
      throw new Error(`${run.runId} costMinor is invalid`);
    }
    if (!Array.isArray(run.technicalDefects)) {
      throw new Error(`${run.runId} technicalDefects must be an array`);
    }
    if (typeof run.notes !== 'string') {
      throw new Error(`${run.runId} notes must be a string`);
    }
    if (
      typeof run.publicEvidenceRef === 'string' &&
      /[?&](?:signature|authorization|token|expires)=/iu.test(run.publicEvidenceRef)
    ) {
      throw new Error(`${run.runId} evidence ref must not be signed`);
    }
  }
}

export function summarizeQualityReview(artifact) {
  validateQualityReview(artifact);
  const successful = artifact.runs.filter((run) => run.success === true);
  const accepted = artifact.runs.filter((run) => run.accepted === true);
  const failed = artifact.runs.filter((run) => run.success === false);
  const knownCosts = artifact.runs.filter((run) => typeof run.costMinor === 'number');
  const knownLatencies = artifact.runs
    .map((run) => run.generationLatencyMs)
    .filter((value) => typeof value === 'number');

  const totalKnownCostMinor = knownCosts.reduce((sum, run) => sum + run.costMinor, 0);
  return {
    requestedCount: artifact.runs.length,
    successfulCount: successful.length,
    failedCount: failed.length,
    acceptedCount: accepted.length,
    rejectedCount: artifact.runs.filter((run) => run.accepted === false).length,
    totalKnownCostMinor,
    costPerAcceptedMinor:
      accepted.length > 0 && knownCosts.length === artifact.runs.length
        ? totalKnownCostMinor / accepted.length
        : null,
    averageGenerationLatencyMs:
      knownLatencies.length === artifact.runs.length
        ? knownLatencies.reduce((sum, value) => sum + value, 0) / knownLatencies.length
        : null,
  };
}
