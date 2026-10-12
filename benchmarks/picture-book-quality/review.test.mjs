import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeQualityReview, validateQualityReview } from './review.mjs';

const run = (runId, overrides = {}) => ({
  runId,
  pageKey: runId.startsWith('page-1') ? 'page-1' : 'page-2',
  revision: runId === 'page-2-regeneration' ? 2 : 1,
  provider: 'BAILIAN',
  model: 'qwen-image-3.0',
  success: true,
  accepted: true,
  generationLatencyMs: 1000,
  costMinor: 18,
  providerRequestId: 'opaque-request-id',
  publicEvidenceRef: 'evidence/page.png',
  scores: {
    faceIdentity: 5,
    clothing: 5,
    colors: 5,
    proportions: 4,
    artMediumStyle: 5,
    sceneContinuity: 4,
    promptAdherence: 5,
  },
  unwantedTextArtifacts: 'NONE',
  technicalDefects: [],
  notes: '',
  ...overrides,
});

const complete = () => ({
  schemaVersion: 1,
  fixtureId: 'm10-two-character-two-page-v1',
  reviewStatus: 'COMPLETE',
  currency: 'CNY',
  runs: [
    run('page-1-original'),
    run('page-2-original', { generationLatencyMs: 2000 }),
    run('page-2-regeneration', { generationLatencyMs: 3000 }),
  ],
});

test('quality gate summarizes accepted/failed counts, latency and cost per accepted image', () => {
  const artifact = complete();
  artifact.runs[1].success = false;
  artifact.runs[1].accepted = false;
  artifact.runs[1].technicalDefects = ['EXTRA_CHARACTER'];

  assert.deepEqual(summarizeQualityReview(artifact), {
    requestedCount: 3,
    successfulCount: 2,
    failedCount: 1,
    acceptedCount: 2,
    rejectedCount: 1,
    totalKnownCostMinor: 54,
    costPerAcceptedMinor: 27,
    averageGenerationLatencyMs: 2000,
  });
});

test('quality gate rejects incomplete final reviews and invalid scores', () => {
  const pending = complete();
  pending.runs[0].accepted = null;
  assert.throws(() => validateQualityReview(pending), /accepted is missing/u);

  const invalid = complete();
  invalid.runs[0].scores.faceIdentity = 6;
  assert.throws(() => validateQualityReview(invalid), /must be 1-5/u);
});

test('quality gate permits the committed pending template only when explicitly requested', () => {
  const pending = complete();
  for (const current of pending.runs) {
    current.provider = null;
    current.model = null;
    current.success = null;
    current.accepted = null;
    current.generationLatencyMs = null;
    current.costMinor = null;
    current.unwantedTextArtifacts = null;
    for (const field of Object.keys(current.scores)) current.scores[field] = null;
  }
  assert.doesNotThrow(() => validateQualityReview(pending, { allowPending: true }));
});

test('quality gate rejects signed evidence URLs', () => {
  const artifact = complete();
  artifact.runs[0].publicEvidenceRef = 'https://assets.example.com/a.png?signature=secret';
  assert.throws(() => validateQualityReview(artifact), /must not be signed/u);
});
