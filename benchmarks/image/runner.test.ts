import { describe, expect, it, vi } from 'vitest';
import { ImageProviderError } from '../../apps/worker/src/image-provider.js';
import { BosStorage } from '../../apps/worker/src/bos-storage.js';
import { imagePrompts, recurringCharacterDescription } from './prompts.js';
import {
  runImageBenchmark,
  selectImagePrompts,
  summarize,
  type BenchmarkImageProvider,
  type BenchmarkModel,
} from './runner.js';
import {
  deriveWorkspaceOrigin,
  QwenBenchmarkImageProvider,
  ZImageTurboBenchmarkProvider,
} from './providers.js';

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
      errorStage: success ? null : 'REQUEST',
      httpStatus: success ? null : 403,
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
          stage: 'BAILIAN_REQUEST',
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
      errorStage: 'BAILIAN_REQUEST',
      httpStatus: 403,
    });
    expect(JSON.stringify(run)).not.toContain('secret');
  });
  it('uses the Qwen compatible endpoint and fair settings', async () => {
    const storage = new BosStorage({
      bucket: 'b',
      publicOrigin: 'https://bos.invalid',
      client: { putObject: vi.fn(async () => undefined) },
    });
    let qwenCalls = 0;
    const fetcher = vi.fn(async () =>
      ++qwenCalls === 1
        ? {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              request_id: 'qwen-id',
              data: [{ url: 'https://provider.invalid/q.png' }],
            }),
          }
        : {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: async () => Buffer.from('89504e470d0a1a0a', 'hex'),
          },
    );
    const provider = new QwenBenchmarkImageProvider(
      'key',
      'https://workspace/compatible-mode/v1',
      storage,
      fetcher,
    );
    await provider.generate({
      generationKey: 'q',
      model: 'qwen-image-3.0',
      prompt: 'p',
      consistency: [],
      signal: new AbortController().signal,
    });
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://workspace/compatible-mode/v1/images/generations',
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({
      model: 'qwen-image-3.0',
      n: 1,
      size: '1024x1024',
      prompt_extend: false,
      enable_thinking: false,
    });
  });
  it.each([
    [
      { error: { code: 'AccessDenied.Unpurchased', message: 'must not be stored' } },
      'AccessDenied.Unpurchased',
    ],
    [{ code: 'Model.AccessDenied', message: 'must not be stored' }, 'Model.AccessDenied'],
  ])('records only safe provider error code for 403 responses', async (body, code) => {
    const storage = new BosStorage({
      bucket: 'b',
      publicOrigin: 'https://bos.invalid',
      client: { putObject: vi.fn(async () => undefined) },
    });
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-request-id': 'safe-request-id' }),
      json: async () => body,
    }));
    const provider = new QwenBenchmarkImageProvider(
      'key',
      'https://workspace/compatible-mode/v1',
      storage,
      fetcher,
    );
    const run = await runImageBenchmark(provider, 'qwen-image-3.0', imagePrompts[0]!, 1);
    expect(run).toMatchObject({
      success: false,
      httpStatus: 403,
      providerRequestId: 'safe-request-id',
      providerErrorCode: code,
    });
    expect(JSON.stringify(run)).not.toContain('must not be stored');
    expect(JSON.stringify(run)).not.toContain('Authorization');
  });
  it('uses the Z-Image native endpoint and parses image/request id', async () => {
    const storage = new BosStorage({
      bucket: 'b',
      publicOrigin: 'https://bos.invalid',
      client: { putObject: vi.fn(async () => undefined) },
    });
    let zCalls = 0;
    const fetcher = vi.fn(async () =>
      ++zCalls === 1
        ? {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              request_id: 'z-id',
              output: {
                choices: [{ message: { content: [{ image: 'https://provider.invalid/z.png' }] } }],
              },
            }),
          }
        : {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: async () => Buffer.from('89504e470d0a1a0a', 'hex'),
          },
    );
    const provider = new ZImageTurboBenchmarkProvider('key', 'https://workspace', storage, fetcher);
    const output = await provider.generate({
      generationKey: 'z',
      model: 'z-image-turbo',
      prompt: 'p',
      consistency: [],
      signal: new AbortController().signal,
    });
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://workspace/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(fetcher.mock.calls[0]![0]).not.toContain('/images/generations');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({
      model: 'z-image-turbo',
      parameters: { size: '1024*1024', prompt_extend: false, n: 1 },
    });
    expect(output.providerRequestId).toBe('z-id');
  });
  it('derives workspace origin and filters a single smoke prompt', () => {
    expect(deriveWorkspaceOrigin('https://workspace/compatible-mode/v1')).toBe('https://workspace');
    expect(selectImagePrompts('character-portrait').map((prompt) => prompt.promptId)).toEqual([
      'portrait-child-friendly',
    ]);
  });
});
