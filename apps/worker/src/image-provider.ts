import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BosStorage } from './bos-storage.js';

export type ImageConsistencyReference = {
  consistencyKey: string;
  visualPrompt: string;
  referenceMediaAssetId: string | null;
};

export type ImageGenerationInput = {
  generationKey: string;
  model: string;
  prompt: string;
  consistency: ImageConsistencyReference[];
  signal: AbortSignal;
};

export type ImageGenerationResult = {
  assetProvider: 'MOCK_IMAGE' | 'BAIDU_BOS';
  objectKey: string;
  playbackUrl: string;
  mimeType: string;
  byteSize: number | null;
  providerRequestId: string;
};

export interface ImageProvider {
  readonly name: 'MOCK' | 'BAILIAN';
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
          generationKey: input.generationKey,
          model: input.model,
          prompt: input.prompt,
          consistency: input.consistency,
        }),
      )
      .digest('hex');
    const objectKey = `picture-books/mock/${digest}.png`;
    return Promise.resolve({
      assetProvider: 'MOCK_IMAGE',
      objectKey,
      playbackUrl: `https://mock.invalid/${objectKey}`,
      mimeType: 'image/png',
      byteSize: null,
      providerRequestId: `mock-image-${digest.slice(0, 24)}`,
    });
  }
}

const bailianImageResponseSchema = z.object({
  request_id: z.string().min(1).optional(),
  data: z.array(z.object({ url: z.url().startsWith('https://') })).min(1),
});

export class BailianImageProvider implements ImageProvider {
  readonly name = 'BAILIAN' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly storage: BosStorage,
    private readonly fetcher: typeof fetch = fetch,
    private readonly maxDownloadBytes = 15 * 1024 * 1024,
  ) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    try {
      const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          prompt: buildPrompt(input.prompt, input.consistency),
          n: 1,
          size: '1024x1024',
        }),
        signal: input.signal,
      });
      if (!response.ok) throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
      const parsed = bailianImageResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');

      const temporaryUrl = parsed.data.data[0]!.url;
      assertTrustedTemporaryUrl(temporaryUrl);
      const imageResponse = await this.fetcher(temporaryUrl, {
        signal: input.signal,
        redirect: 'error',
      });
      if (!imageResponse.ok) throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
      const mimeType = imageResponse.headers.get('content-type')?.split(';')[0]?.trim();
      if (mimeType !== 'image/png') throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
      const contentLength = Number(imageResponse.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > this.maxDownloadBytes)
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
      const body = await readBoundedBody(imageResponse, this.maxDownloadBytes);
      if (body.byteLength === 0) throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');

      const objectKey = `picture-books/bailian/${encodeURIComponent(input.generationKey)}.png`;
      const stored = await this.storage.putImage({ objectKey, body, mimeType });
      return {
        assetProvider: 'BAIDU_BOS',
        ...stored,
        mimeType,
        providerRequestId:
          response.headers.get('x-request-id') ?? parsed.data.request_id ?? 'bailian-image-unknown',
      };
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      if (input.signal.aborted) throw new ImageProviderError('IMAGE_PROVIDER_TIMEOUT');
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
    }
  }
}

const buildPrompt = (prompt: string, consistency: ImageConsistencyReference[]): string => {
  if (consistency.length === 0) return prompt;
  const characterConstraints = consistency
    .map((item, index) => `${index + 1}. ${item.visualPrompt}`)
    .join('\n');
  return `${prompt}\n\nKeep these character appearances consistent:\n${characterConstraints}`;
};

const readBoundedBody = async (response: Response, maxBytes: number): Promise<Buffer> => {
  if (!response.body) throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    if (byteSize > maxBytes) {
      await reader.cancel();
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, byteSize);
};

const assertTrustedTemporaryUrl = (value: string): void => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.hostname !== 'aliyuncs.com' && !url.hostname.endsWith('.aliyuncs.com'))
  ) {
    throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE');
  }
};
