import { createHash } from 'node:crypto';

export type ImageConsistencyReference = {
  consistencyKey: string;
  visualPrompt: string;
  referenceMediaAssetId: string | null;
};

export type ImageGenerationInput = {
  model: string;
  prompt: string;
  consistency: ImageConsistencyReference[];
  signal: AbortSignal;
};

export type ImageGenerationResult = {
  objectKey: string;
  playbackUrl: string;
  mimeType: string;
  byteSize: number | null;
  providerRequestId: string;
};

export interface ImageProvider {
  readonly name: 'MOCK';
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

export class ImageProviderError extends Error {
  constructor(readonly code: 'IMAGE_PROVIDER_UNAVAILABLE' | 'IMAGE_PROVIDER_TIMEOUT') {
    super(code);
  }
}

export class MockImageProvider implements ImageProvider {
  readonly name = 'MOCK' as const;

  generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (input.signal.aborted) throw new ImageProviderError('IMAGE_PROVIDER_TIMEOUT');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          consistency: input.consistency,
        }),
      )
      .digest('hex');
    const objectKey = `picture-books/mock/${digest}.png`;
    return Promise.resolve({
      objectKey,
      playbackUrl: `https://mock.invalid/${objectKey}`,
      mimeType: 'image/png',
      byteSize: null,
      providerRequestId: `mock-image-${digest.slice(0, 24)}`,
    });
  }
}
