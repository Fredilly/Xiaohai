import type { BosStorage } from '../../apps/worker/src/bos-storage.js';
import type {
  ImageGenerationInput,
  ImageGenerationResult,
} from '../../apps/worker/src/image-provider.js';

const httpsUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('https://');
const qwenImageUrl = (body: any): string | null =>
  httpsUrl(body?.data?.[0]?.url) ? body.data[0].url : null;
const zImageUrl = (body: any): string | null =>
  httpsUrl(body?.output?.choices?.[0]?.message?.content?.[0]?.image)
    ? body.output.choices[0].message.content[0].image
    : null;
const bodyRequestId = (body: any): string | undefined =>
  typeof body?.request_id === 'string' && body.request_id.length > 0 ? body.request_id : undefined;

export class BenchmarkImageProviderError extends Error {
  constructor(
    readonly code: 'IMAGE_PROVIDER_UNAVAILABLE' | 'IMAGE_PROVIDER_TIMEOUT',
    readonly details: { stage?: string; httpStatus?: number; providerRequestId?: string } = {},
  ) {
    super(code);
  }
}

type Fetcher = typeof fetch;

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function downloadAndStore(
  url: string,
  requestId: string,
  input: ImageGenerationInput,
  storage: BosStorage,
  fetcher: Fetcher,
  prefix: string,
): Promise<ImageGenerationResult> {
  let response: Response;
  try {
    response = await fetcher(url, { signal: input.signal, redirect: 'error' });
  } catch {
    if (input.signal.aborted)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_TIMEOUT', {
        stage: 'TEMPORARY_IMAGE_DOWNLOAD',
        providerRequestId: requestId,
      });
    throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
      stage: 'TEMPORARY_IMAGE_DOWNLOAD',
      providerRequestId: requestId,
    });
  }
  try {
    if (!response.ok)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'TEMPORARY_IMAGE_DOWNLOAD',
        httpStatus: response.status,
        providerRequestId: requestId,
      });
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (mimeType !== 'image/png')
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        providerRequestId: requestId,
      });
    const body = Buffer.from(await response.arrayBuffer());
    if (
      body.byteLength === 0 ||
      body.byteLength > 15 * 1024 * 1024 ||
      body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        providerRequestId: requestId,
      });
    const stored = await storage.putImage({
      objectKey: `benchmarks/image/${prefix}/${encodeURIComponent(input.generationKey)}.png`,
      body,
      mimeType,
    });
    return { assetProvider: 'BAIDU_BOS', ...stored, mimeType, providerRequestId: requestId };
  } catch (error) {
    if (error instanceof BenchmarkImageProviderError) throw error;
    if (input.signal.aborted)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_TIMEOUT', {
        stage: 'TEMPORARY_IMAGE_DOWNLOAD',
        providerRequestId: requestId,
      });
    throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
      stage: 'BOS_UPLOAD',
      providerRequestId: requestId,
    });
  }
}

abstract class DashScopeBenchmarkProvider {
  constructor(
    protected readonly apiKey: string,
    protected readonly baseUrl: string,
    protected readonly storage: BosStorage,
    protected readonly fetcher: Fetcher = fetch,
  ) {}

  protected async request(
    url: string,
    body: unknown,
    input: ImageGenerationInput,
  ): Promise<{ body: unknown; requestId: string }> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch {
      if (input.signal.aborted)
        throw new BenchmarkImageProviderError('IMAGE_PROVIDER_TIMEOUT', { stage: 'REQUEST' });
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', { stage: 'REQUEST' });
    }
    const requestId = response.headers.get('x-request-id') ?? '';
    const responseBody = await json(response);
    if (!response.ok)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'REQUEST',
        httpStatus: response.status,
        providerRequestId: requestId || undefined,
      });
    return { body: responseBody, requestId };
  }
}

export class QwenBenchmarkImageProvider extends DashScopeBenchmarkProvider {
  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const result = await this.request(
      `${this.baseUrl.replace(/\/$/u, '')}/images/generations`,
      {
        model: input.model,
        prompt: input.prompt,
        n: 1,
        size: '1024x1024',
        prompt_extend: false,
      },
      input,
    );
    const imageUrl = qwenImageUrl(result.body);
    if (!imageUrl)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        providerRequestId: result.requestId || undefined,
      });
    return downloadAndStore(
      imageUrl,
      result.requestId || bodyRequestId(result.body) || 'qwen-request',
      input,
      this.storage,
      this.fetcher,
      'qwen-image-3.0',
    );
  }
}

export class ZImageTurboBenchmarkProvider extends DashScopeBenchmarkProvider {
  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const result = await this.request(
      `${this.baseUrl.replace(/\/$/u, '')}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        model: input.model,
        input: { messages: [{ role: 'user', content: [{ text: input.prompt }] }] },
        parameters: { size: '1024*1024', prompt_extend: false, n: 1 },
      },
      input,
    );
    const imageUrl = zImageUrl(result.body);
    if (!imageUrl)
      throw new BenchmarkImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        providerRequestId: result.requestId || undefined,
      });
    const requestId = result.requestId || bodyRequestId(result.body) || 'z-image-request';
    return downloadAndStore(
      imageUrl,
      requestId,
      input,
      this.storage,
      this.fetcher,
      'z-image-turbo',
    );
  }
}

export const deriveWorkspaceOrigin = (baseUrl: string): string =>
  baseUrl.replace(/\/compatible-mode\/v1\/?$/u, '').replace(/\/$/u, '');
