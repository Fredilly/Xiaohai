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
  referenceImages?: string[];
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

export type ImageProviderStage =
  | 'BAILIAN_REQUEST'
  | 'TEMPORARY_IMAGE_DOWNLOAD'
  | 'VALIDATION'
  | 'BOS_UPLOAD'
  | 'BUDGET_VALIDATION'
  | 'DB_READY_WRITEBACK';

export class ImageProviderError extends Error {
  constructor(
    readonly code: 'IMAGE_PROVIDER_UNAVAILABLE' | 'IMAGE_PROVIDER_TIMEOUT',
    readonly details: {
      stage?: ImageProviderStage;
      validationCode?:
        | 'RESPONSE_SCHEMA_INVALID'
        | 'IMAGE_URL_MISSING'
        | 'UNTRUSTED_TEMPORARY_URL'
        | 'TEMPORARY_MIME_INVALID'
        | 'TEMPORARY_SIZE_INVALID'
        | 'TEMPORARY_IMAGE_EMPTY'
        | 'AI_BUDGET_RESERVATION_REQUIRED';
      httpStatus?: number;
      providerErrorCode?: string;
      safeMessage?: string;
      providerRequestId?: string;
    } = {},
  ) {
    super(code);
  }
}

export class MockImageProvider implements ImageProvider {
  readonly name = 'MOCK' as const;

  // The API exposes this deterministic dev-only image endpoint. It keeps MOCK
  // assets renderable in WeChat DevTools without contacting object storage or a
  // paid provider.
  private readonly playbackOrigin =
    process.env.MOCK_IMAGE_PLAYBACK_ORIGIN ?? 'http://127.0.0.1:3000/api/v1/dev/mock-images';

  generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (input.signal.aborted) throw new ImageProviderError('IMAGE_PROVIDER_TIMEOUT');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          generationKey: input.generationKey,
          model: input.model,
          prompt: input.prompt,
          consistency: input.consistency,
          referenceImages: input.referenceImages,
        }),
      )
      .digest('hex');
    const objectKey = `picture-books/mock/${digest}.png`;
    return Promise.resolve({
      assetProvider: 'MOCK_IMAGE',
      objectKey,
      playbackUrl: `${this.playbackOrigin}/${digest}.jpg`,
      mimeType: 'image/png',
      byteSize: null,
      providerRequestId: `mock-image-${digest.slice(0, 24)}`,
    });
  }
}

const bailianImageResponseSchema = z.object({
  request_id: z.string().min(1).optional(),
  output: z
    .object({
      choices: z
        .array(
          z.object({
            message: z.object({
              content: z.array(z.object({ image: z.url().startsWith('https://') }).passthrough()),
            }),
          }),
        )
        .min(1),
    })
    .optional(),
  data: z.array(z.object({ url: z.url().startsWith('https://') })).optional(),
});

const bailianErrorResponseSchema = z.object({
  request_id: z.string().min(1).optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
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
      let response: Response;
      try {
        // Qwen Image 3.0 uses the compatible Images endpoint for T2I and I2I.
        // I2I reference images are a top-level "image" field, not DashScope messages.
        const compatibleMode =
          !input.referenceImages?.length ||
          input.model === 'qwen-image-3.0' ||
          input.model === 'qwen-image-3.0-pro';
        const endpoint = compatibleMode
          ? `${this.baseUrl.replace(/\/$/, '')}/images/generations`
          : `${this.baseUrl.replace(/\/$/, '')}/api/v1/services/aigc/multimodal-generation/generation`;
        const body = compatibleMode
          ? {
              model: input.model,
              prompt: buildPrompt(input.prompt, input.consistency),
              ...(input.referenceImages?.length ? { image: input.referenceImages } : {}),
              n: 1,
              size: '1024x1024',
            }
          : {
              model: input.model,
              input: {
                messages: [
                  {
                    role: 'user',
                    content: [
                      ...(input.referenceImages?.map((image) => ({ image })) ?? []),
                      { text: buildPrompt(input.prompt, input.consistency) },
                    ],
                  },
                ],
              },
              parameters: { n: 1, size: '1024x1024' },
            };
        response = await this.fetcher(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: input.signal,
        });
      } catch {
        if (input.signal.aborted)
          throw new ImageProviderError('IMAGE_PROVIDER_TIMEOUT', { stage: 'BAILIAN_REQUEST' });
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'BAILIAN_REQUEST',
          safeMessage: undefined,
        });
      }
      if (!response.ok) {
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const errorBody = await readJson(response);
        const error = bailianErrorResponseSchema.safeParse(errorBody);
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'BAILIAN_REQUEST',
          httpStatus: response.status,
          providerErrorCode: error.success ? error.data.error?.code : undefined,
          safeMessage: error.success
            ? sanitizeProviderMessage(error.data.error?.message)
            : undefined,
          providerRequestId: requestId ?? (error.success ? error.data.request_id : undefined),
        });
      }
      const responseRequestId = response.headers.get('x-request-id') ?? undefined;
      const parsedBody = await readJson(response);
      const parsed = bailianImageResponseSchema.safeParse(parsedBody);
      if (!parsed.success)
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'VALIDATION',
          validationCode: 'RESPONSE_SCHEMA_INVALID',
          providerRequestId: responseRequestId,
        });

      const temporaryUrl =
        parsed.data.output?.choices[0]?.message.content[0]?.image ?? parsed.data.data?.[0]?.url;
      if (!temporaryUrl)
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'VALIDATION',
          validationCode: 'IMAGE_URL_MISSING',
          providerRequestId: responseRequestId,
        });
      let body: Buffer;
      let mimeType: string;
      try {
        assertTrustedTemporaryUrl(temporaryUrl);
        const imageResponse = await this.fetcher(temporaryUrl, {
          signal: input.signal,
          redirect: 'error',
        });
        if (!imageResponse.ok)
          throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
            stage: 'TEMPORARY_IMAGE_DOWNLOAD',
            httpStatus: imageResponse.status,
          });
        mimeType = imageResponse.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (mimeType !== 'image/png')
          throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
            stage: 'VALIDATION',
            validationCode: 'TEMPORARY_MIME_INVALID',
            providerRequestId: responseRequestId,
          });
        const contentLength = Number(imageResponse.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > this.maxDownloadBytes)
          throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
            stage: 'VALIDATION',
            validationCode: 'TEMPORARY_SIZE_INVALID',
            providerRequestId: responseRequestId,
          });
        body = await readBoundedBody(imageResponse, this.maxDownloadBytes);
        if (body.byteLength === 0)
          throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
            stage: 'VALIDATION',
            validationCode: 'TEMPORARY_IMAGE_EMPTY',
            providerRequestId: responseRequestId,
          });
      } catch (error) {
        if (error instanceof ImageProviderError) throw error;
        if (input.signal.aborted)
          throw new ImageProviderError('IMAGE_PROVIDER_TIMEOUT', {
            stage: 'TEMPORARY_IMAGE_DOWNLOAD',
          });
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'TEMPORARY_IMAGE_DOWNLOAD',
        });
      }

      const objectKey = `picture-books/bailian/${encodeURIComponent(input.generationKey)}.png`;
      let stored: Awaited<ReturnType<BosStorage['putImage']>>;
      try {
        stored = await this.storage.putImage({ objectKey, body, mimeType });
      } catch (error) {
        const bos = safeBosError(error);
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'BOS_UPLOAD',
          providerRequestId:
            response.headers.get('x-request-id') ?? parsed.data.request_id ?? undefined,
          ...bos,
        });
      }
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

const sanitizeProviderMessage = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?key|secret|ak|sk|signature|token)["'=:\s]+)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 256);
};

const safeBosError = (
  error: unknown,
): Pick<ImageProviderError['details'], 'httpStatus' | 'providerErrorCode'> => {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as { statusCode?: unknown; status?: unknown; code?: unknown };
  return {
    httpStatus:
      typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : typeof candidate.status === 'number'
          ? candidate.status
          : undefined,
    providerErrorCode: typeof candidate.code === 'string' ? candidate.code : undefined,
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const buildPrompt = (prompt: string, consistency: ImageConsistencyReference[]): string => {
  if (consistency.length === 0) return prompt;
  const characterConstraints = consistency
    .map((item, index) => `${index + 1}. ${item.visualPrompt}`)
    .join('\n');
  return `${prompt}\n\nKeep these character appearances consistent:\n${characterConstraints}`;
};

const readBoundedBody = async (response: Response, maxBytes: number): Promise<Buffer> => {
  if (!response.body)
    throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
      stage: 'VALIDATION',
      validationCode: 'TEMPORARY_IMAGE_EMPTY',
    });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    if (byteSize > maxBytes) {
      await reader.cancel();
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        validationCode: 'TEMPORARY_SIZE_INVALID',
      });
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
    throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
      stage: 'VALIDATION',
      validationCode: 'UNTRUSTED_TEMPORARY_URL',
    });
  }
};
