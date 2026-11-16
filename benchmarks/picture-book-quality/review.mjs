const SCORE_FIELDS = [
  'faceIdentity',
  'clothing',
  'colors',
  'proportions',
  'artMediumStyle',
  'sceneContinuity',
  'promptAdherence',
];

const EXPECTED_RUNS = new Map([
  ['page-1-original', { pageKey: 'page-1', revision: 1 }],
  ['page-2-original', { pageKey: 'page-2', revision: 1 }],
  ['page-2-regeneration', { pageKey: 'page-2', revision: 2 }],
]);

export function validateQualityReview(artifact, { allowPending = false } = {}) {
  if (
    !artifact ||
    artifact.schemaVersion !== 1 ||
    artifact.fixtureId !== 'm10-two-character-two-page-v1'
  ) {
    throw new Error('unexpected quality fixture');
  }
  if (!Array.isArray(artifact.runs) || artifact.runs.length !== 3) {
    throw new Error('quality review must contain exactly 3 runs');
  }

  if (!allowPending) {
    if (artifact.reviewStatus !== 'COMPLETE') throw new Error('human review is not complete');
    if (typeof artifact.reviewer !== 'string' || !artifact.reviewer.trim()) {
      throw new Error('human reviewer is missing');
    }
    if (
      typeof artifact.reviewedAt !== 'string' ||
      !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/u.test(artifact.reviewedAt) ||
      Number.isNaN(Date.parse(artifact.reviewedAt))
    ) {
      throw new Error('human reviewedAt is missing or invalid');
    }
    if (artifact.currency !== 'CNY') throw new Error('quality review currency must be CNY');
  }

  const seen = new Set();

  for (const run of artifact.runs) {
    const expectedRun = EXPECTED_RUNS.get(run.runId);
    if (!expectedRun || seen.has(run.runId)) {
      throw new Error(`invalid or duplicate run ${run.runId}`);
    }
    seen.add(run.runId);
    if (run.pageKey !== expectedRun.pageKey || run.revision !== expectedRun.revision) {
      throw new Error(`${run.runId} page or regeneration revision mismatch`);
    }
    if (run.success != null && typeof run.success !== 'boolean') {
      throw new Error(`${run.runId} success must be boolean`);
    }
    if (run.accepted != null && typeof run.accepted !== 'boolean') {
      throw new Error(`${run.runId} accepted must be boolean`);
    }
    if (run.success === false && run.accepted === true) {
      throw new Error(`${run.runId} failed generation cannot be accepted`);
    }

    if (!allowPending) {
      for (const field of [
        'provider',
        'model',
        'success',
        'accepted',
        'generationLatencyMs',
        'costMinor',
        'publicEvidenceRef',
      ]) {
        if (run[field] === null || run[field] === undefined) {
          throw new Error(`${run.runId} ${field} is missing`);
        }
      }
      if (run.provider !== 'BAILIAN' || run.model !== 'qwen-image-3.0') {
        throw new Error(`${run.runId} provider/model differs from frozen fixture`);
      }
      if (typeof run.publicEvidenceRef !== 'string' || !run.publicEvidenceRef.trim()) {
        throw new Error(`${run.runId} review evidence reference is missing`);
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
        if (!Number.isInteger(value) || value < 1 || value > 5) {
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
    if (run.technicalDefects.some((defect) =>
      typeof defect !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(defect)
    )) {
      throw new Error(`${run.runId} technicalDefects must contain safe codes`);
    }
    if (
      run.accepted === true &&
      (run.unwantedTextArtifacts !== 'NONE' ||
        run.technicalDefects.some((defect) =>
          /^(?:EXTRA_|DUPLICATE_|GARBLED_|UNREQUESTED_|MISSING_LIMB)/u.test(defect)
        ))
    ) {
      throw new Error(`${run.runId} critical artifact cannot be accepted`);
    }
    if (typeof run.notes !== 'string') {
      throw new Error(`${run.runId} notes must be a string`);
    }
    if (
      typeof run.publicEvidenceRef === 'string' &&
      /[?#]|(?:authorization|signature|secret|access.?key|token)/iu.test(run.publicEvidenceRef)
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
