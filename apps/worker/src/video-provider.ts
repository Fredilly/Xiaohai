import { createHash } from 'node:crypto';

export type VideoConsistencyReference = {
  consistencyKey: string;
  visualPrompt: string;
  referenceMediaAssetId: string | null;
};

export type VideoGenerationInput = {
  generationKey: string;
  model: string;
  prompt: string;
  plannedDurationMs: number;
  consistency: VideoConsistencyReference[];
  signal: AbortSignal;
};

export type VideoGenerationResult = {
  objectKey: string;
  playbackUrl: string;
  mimeType: 'video/mp4';
  byteSize: number | null;
  durationSeconds: number;
  providerRequestId: string;
};

export interface VideoProvider {
  readonly name: 'MOCK';
  generate(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}

export class VideoProviderError extends Error {
  constructor(
    readonly code:
      'VIDEO_PROVIDER_UNAVAILABLE' | 'VIDEO_PROVIDER_TIMEOUT' | 'VIDEO_PROVIDER_INVALID_OUTPUT',
  ) {
    super(code);
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly name = 'MOCK' as const;

  generate(input: VideoGenerationInput): Promise<VideoGenerationResult> {
    if (input.signal.aborted) {
      return Promise.reject(new VideoProviderError('VIDEO_PROVIDER_TIMEOUT'));
    }

    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          generationKey: input.generationKey,
          model: input.model,
          prompt: input.prompt,
          plannedDurationMs: input.plannedDurationMs,
          consistency: input.consistency,
        }),
      )
      .digest('hex');

    const objectKey = `animations/mock/${digest}.mp4`;

    return Promise.resolve({
      objectKey,
      playbackUrl: `https://mock.invalid/${objectKey}`,
      mimeType: 'video/mp4',
      byteSize: null,
      durationSeconds: Math.max(1, Math.ceil(input.plannedDurationMs / 1000)),
      providerRequestId: `mock-video-${digest.slice(0, 24)}`,
    });
  }
}
