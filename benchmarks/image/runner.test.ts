import { describe, expect, it, vi } from 'vitest';
import { ImageProviderError } from '../../apps/worker/src/image-provider.js';
import { imagePrompts, recurringCharacterDescription } from './prompts.js';
import {
  runImageBenchmark,
  summarize,
  type BenchmarkImageProvider,
  type BenchmarkModel,
} from './runner.js';

const result = (id = 'request-id') => ({
  assetProvider: 'MOCK_IMAGE' as const,
  objectKey: 'benchmark/out.png',
  playbackUrl: 'https://safe.invalid/benchmark/out.png',
  mimeType: 'image/png',
  byteSize: 12,
  providerRequestId: id,
});

describe('image benchmark', () => {
  it('has six prompts and identical recurring character description', () => {
    expect(imagePrompts).toHaveLength(6);
    expect(imagePrompts[0]!.prompt).toContain(recurringCharacterDescription);
    expect(imagePrompts[1]!.prompt).toContain(recurringCharacterDescription);
    expect(imagePrompts[2]!.prompt).toContain(recurringCharacterDescription);
  });
  it('uses identical settings and records successful output references', async () => {
    const generate = vi.fn(async () => result());
    const provider: BenchmarkImageProvider = { generate };
    const run = await runImageBenchmark(provider, 'qwen-image-3.0', imagePrompts[0]!, 1);
    expect(run).toMatchObject({
      model: 'qwen-image-3.0',
      success: true,
      outputReference: 'https://safe.invalid/benchmark/out.png',
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen-image-3.0', prompt: imagePrompts[0]!.prompt }),
    );
  });
  it('calculates p50/p95 and failure count', () => {
    const make = (latency: number, success: boolean) => ({
      model: 'z-image-turbo' as BenchmarkModel,
      promptId: 'p',
      runNumber: latency,
      success,
      generationLatencyMs: latency,
      providerRequestId: null,
      outputReference: null,
      width: null,
      height: null,
      obviousTechnicalDefects: [],
      errorCode: success ? null : 'IMAGE_PROVIDER_UNAVAILABLE',
      humanRating: {
        characterConsistency: null,
        promptAdherence: null,
        illustrationQuality: null,
        notes: '',
      },
    });
    expect(
      summarize('z-image-turbo', [
        make(10, true),
        make(20, true),
        make(30, true),
        make(40, true),
        make(50, false),
      ]),
    ).toMatchObject({ p50LatencyMs: 20, p95LatencyMs: 40, failureCount: 1, successRate: 0.8 });
  });
  it('keeps provider failures safe', async () => {
    const provider: BenchmarkImageProvider = {
      generate: vi.fn(async () => {
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          providerRequestId: 'safe-id',
          httpStatus: 403,
        });
      }),
    };
    const run = await runImageBenchmark(provider, 'z-image-turbo', imagePrompts[0]!, 1);
    expect(run).toMatchObject({
      success: false,
      errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
      providerRequestId: 'safe-id',
    });
    expect(JSON.stringify(run)).not.toContain('secret');
  });
});
