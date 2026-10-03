import { describe, expect, it } from 'vitest';
import { buildArtifact, reviewTemplate } from './finalize.mjs';

const runs = Array.from({ length: 36 }, (_, index) => ({
  model: index % 2 === 0 ? 'qwen-image-3.0' : 'z-image-turbo',
  promptId: `prompt-${Math.floor(index / 6)}`,
  runNumber: (index % 3) + 1,
  success: true,
  generationLatencyMs: 1000 + index,
  providerRequestId: `request-${index}`,
  outputReference: `https://public.invalid/image-${index}.png`,
  width: null,
  height: null,
  errorCode: null,
  errorStage: null,
  httpStatus: null,
  providerErrorCode: null,
}));
const raw = { models: ['qwen-image-3.0', 'z-image-turbo'], runs };

describe('offline image benchmark finalization', () => {
  it('creates exactly 36 uniquely matched redacted runs', () => {
    const reviews = reviewTemplate(runs);
    reviews[0].obviousTechnicalDefects = ['UNREQUESTED_HUMAN_CHARACTER'];
    reviews[0].promptAdherence = 3;
    const artifact = buildArtifact(raw, reviews, 'pending', true);
    expect(artifact.runs).toHaveLength(36);
    expect(artifact.runs.filter((run) => run.model === 'qwen-image-3.0')).toHaveLength(18);
    expect(artifact.runs.filter((run) => run.model === 'z-image-turbo')).toHaveLength(18);
    expect(artifact.runs[0]).toMatchObject({
      generationLatencyMs: 1000,
      outputReference: 'https://public.invalid/image-0.png',
      obviousTechnicalDefects: ['UNREQUESTED_HUMAN_CHARACTER'],
    });
    expect(JSON.stringify(artifact)).not.toContain('Authorization');
    expect(JSON.stringify(artifact)).not.toContain('provider body');
  });
  it('rejects a missing review record', () => {
    expect(() => buildArtifact(raw, reviewTemplate(runs).slice(1))).toThrow('exactly 36');
  });
  it('rejects incomplete ratings for finalization', () => {
    expect(() => buildArtifact(raw, reviewTemplate(runs))).toThrow('is missing');
  });
  it('rejects duplicate or invalid ratings without network access', () => {
    const reviews = reviewTemplate(runs);
    reviews[1] = { ...reviews[0] };
    expect(() => buildArtifact(raw, reviews, 'pending', true)).toThrow('uniquely match');
    const valid = reviewTemplate(runs);
    valid[0].illustrationQuality = 6;
    expect(() => buildArtifact(raw, valid, 'pending', true)).toThrow('must be 1-5');
  });
});
