import { describe, expect, it } from 'vitest';
import { MockVideoProvider, VideoProviderError } from '../src/video-provider.js';

describe('MockVideoProvider', () => {
  it('returns deterministic video metadata without embedding video binary', async () => {
    const provider = new MockVideoProvider();

    const input = {
      generationKey: 'scene-generation-revision-id',
      model: 'mock-video-v1',
      prompt: 'orange fox walking through a morning forest',
      plannedDurationMs: 5200,
      consistency: [
        {
          consistencyKey: '7dbe8e93-17cc-4bd5-87a5-1c787287f734',
          visualPrompt: 'orange fox with green scarf',
          referenceMediaAssetId: null,
        },
      ],
      signal: new AbortController().signal,
    };

    const first = await provider.generate(input);
    const second = await provider.generate(input);

    expect(first).toEqual(second);
    expect(first.objectKey).toMatch(/^animations\/mock\/[a-f0-9]{64}\.mp4$/);
    expect(first.mimeType).toBe('video/mp4');
    expect(first.durationSeconds).toBe(6);
    expect(JSON.stringify(first)).not.toMatch(/base64|data:video/i);

    const nextRevision = await provider.generate({
      ...input,
      generationKey: 'next-scene-generation-revision-id',
    });

    expect(nextRevision.objectKey).not.toBe(first.objectKey);
  });

  it('fails with a timeout error when the request signal is already aborted', async () => {
    const provider = new MockVideoProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generate({
        generationKey: 'aborted-generation',
        model: 'mock-video-v1',
        prompt: 'forest',
        plannedDurationMs: 5000,
        consistency: [],
        signal: controller.signal,
      }),
    ).rejects.toEqual(new VideoProviderError('VIDEO_PROVIDER_TIMEOUT'));
  });
});
