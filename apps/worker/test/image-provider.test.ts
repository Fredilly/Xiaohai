import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { BosStorage, type BosStorageOptions } from '../src/bos-storage.js';
import {
  BailianImageProvider,
  ImageProviderError,
  MockImageProvider,
} from '../src/image-provider.js';

describe('MockImageProvider', () => {
  it('returns a deterministic DevTools-loadable local image URL and never image binary', async () => {
    const provider = new MockImageProvider();
    const input = {
      generationKey: 'illustration-revision-id',
      model: 'mock-image-v1',
      prompt: 'fox in a forest',
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
    expect(first.objectKey).toMatch(/^picture-books\/mock\/[a-f0-9]{64}\.png$/);
    expect(first.playbackUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:3000\/api\/v1\/dev\/mock-images\/[a-f0-9]{64}\.jpg$/,
    );
    expect(first.playbackUrl).not.toMatch(/mock\.invalid|qwen|bailian/i);
    expect(JSON.stringify(first)).not.toMatch(/base64|data:image/i);

    const nextRevision = await provider.generate({ ...input, generationKey: 'next-revision-id' });
    expect(nextRevision.objectKey).not.toBe(first.objectKey);
  });
});

describe('BailianImageProvider', () => {
  const input = {
    generationKey: 'illustration-revision-id',
    model: 'qwen-image-3.0',
    prompt: 'fox in a forest',
    consistency: [
      {
        consistencyKey: '7dbe8e93-17cc-4bd5-87a5-1c787287f734',
        visualPrompt: 'orange fox with green scarf',
        referenceMediaAssetId: null,
      },
    ],
    signal: new AbortController().signal,
  };

  it('downloads the temporary image and uploads it to BOS before returning', async () => {
    const putObject = vi.fn<BosStorageOptions['client']['putObject']>().mockResolvedValue({});
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: 'https://result.oss-cn-beijing.aliyuncs.com/temp.png' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('png-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '9' },
        }),
      );

    const result = await new BailianImageProvider(
      'not-a-real-key',
      'https://workspace.example.com/compatible-mode/v1',
      storage,
      fetcher,
    ).generate(input);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://workspace.example.com/compatible-mode/v1/images/generations',
      expect.objectContaining({ method: 'POST', signal: input.signal }),
    );
    const request = fetcher.mock.calls[0]![1]!;
    expect(typeof request.body).toBe('string');
    const requestBody = request.body as string;
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'qwen-image-3.0',
      n: 1,
      size: '1024x1024',
    });
    expect(requestBody).toContain('orange fox with green scarf');
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://result.oss-cn-beijing.aliyuncs.com/temp.png',
      { signal: input.signal, redirect: 'error' },
    );
    expect(putObject).toHaveBeenCalledOnce();
    expect(result).toEqual({
      assetProvider: 'BAIDU_BOS',
      objectKey: 'picture-books/bailian/illustration-revision-id.png',
      playbackUrl: 'https://assets.example.com/picture-books/bailian/illustration-revision-id.png',
      mimeType: 'image/png',
      byteSize: 9,
      providerRequestId: 'req-1',
    });
  });

  it.each(['qwen-image-3.0', 'qwen-image-3.0-pro'])(
    'uses the compatible images endpoint with top-level references for %s',
    async (model) => {
      const putObject = vi.fn<BosStorageOptions['client']['putObject']>().mockResolvedValue({});
      const storage = new BosStorage({
        bucket: 'xiaohai-assets',
        publicOrigin: 'https://assets.example.com',
        client: { putObject },
      });
      const referenceImages = [
        'https://assets.example.com/character-a.png',
        'https://assets.example.com/character-b.png',
      ];
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: [{ url: 'https://result.oss-cn-beijing.aliyuncs.com/edited.png' }] }),
            { status: 200, headers: { 'x-request-id': 'req-i2i-1' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(Buffer.from('png-bytes'), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        );

      const result = await new BailianImageProvider(
        'not-a-real-key',
        'https://workspace.example.com/compatible-mode/v1',
        storage,
        fetcher,
      ).generate({ ...input, model, referenceImages });

      expect(fetcher).toHaveBeenNthCalledWith(
        1,
        'https://workspace.example.com/compatible-mode/v1/images/generations',
        expect.objectContaining({ method: 'POST', signal: input.signal }),
      );
      const requestBody = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
      expect(requestBody).toMatchObject({
        model,
        prompt: expect.stringContaining('orange fox with green scarf'),
        image: referenceImages,
        n: 1,
        size: '1024x1024',
      });
      expect(requestBody).not.toHaveProperty('input');
      expect(requestBody).not.toHaveProperty('parameters');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(putObject).toHaveBeenCalledOnce();
      expect(result.providerRequestId).toBe('req-i2i-1');
      expect(result.assetProvider).toBe('BAIDU_BOS');
    },
  );

  it('identifies an invalid provider response schema without logging its body', async () => {
    const putObject = vi.fn().mockResolvedValue({});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'not-a-url' }] }), {
        status: 200,
        headers: { 'x-request-id': 'req-invalid-schema' },
      }),
    );
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    await expect(
      new BailianImageProvider(
        'not-a-real-key',
        'https://workspace.example.com/compatible-mode/v1',
        storage,
        fetcher,
      ).generate({ ...input, referenceImages: ['https://assets.example.com/character.png'] }),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      details: {
        stage: 'VALIDATION',
        validationCode: 'RESPONSE_SCHEMA_INVALID',
        providerRequestId: 'req-invalid-schema',
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('identifies a missing image URL with an allowlisted validation code', async () => {
    const putObject = vi.fn().mockResolvedValue({});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'x-request-id': 'req-no-image' },
      }),
    );
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    await expect(
      new BailianImageProvider(
        'not-a-real-key',
        'https://workspace.example.com/compatible-mode/v1',
        storage,
        fetcher,
      ).generate(input),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      details: {
        stage: 'VALIDATION',
        validationCode: 'IMAGE_URL_MISSING',
        providerRequestId: 'req-no-image',
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('preserves HTTP 404 and request ID for a misconfigured image endpoint without uploading', async () => {
    const putObject = vi.fn().mockResolvedValue({});
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ModelNotFound' }, request_id: 'req-404' }), {
        status: 404,
      }),
    );
    await expect(
      new BailianImageProvider(
        'secret',
        'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        storage,
        fetcher,
      ).generate(input),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      details: {
        stage: 'BAILIAN_REQUEST',
        httpStatus: 404,
        providerErrorCode: 'ModelNotFound',
        providerRequestId: 'req-404',
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations',
      expect.anything(),
    );
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects an untrusted temporary URL without downloading or uploading it', async () => {
    const putObject = vi.fn<BosStorageOptions['client']['putObject']>().mockResolvedValue({});
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'https://127.0.0.1/private.png' }] }), {
        status: 200,
      }),
    );

    await expect(
      new BailianImageProvider(
        'not-a-real-key',
        'https://api.example.com',
        storage,
        fetcher,
      ).generate(input),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      details: { stage: 'VALIDATION' },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(putObject).not.toHaveBeenCalled();
  });

  it.each([400, 403])('preserves safe Bailian error metadata for HTTP %s', async (status) => {
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject: vi.fn().mockResolvedValue({}) },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: 'body-request-id',
          error: {
            code: 'InvalidApiKey',
            message: `Bearer secret-token api_key=private-key ${'x'.repeat(300)}\nnext`,
          },
        }),
        { status, headers: { 'x-request-id': 'header-request-id' } },
      ),
    );

    let caught: unknown;
    try {
      await new BailianImageProvider(
        'secret',
        'https://api.example.com',
        storage,
        fetcher,
      ).generate(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImageProviderError);
    const error = caught as ImageProviderError;
    expect(error).toMatchObject({
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      details: {
        stage: 'BAILIAN_REQUEST',
        httpStatus: status,
        providerErrorCode: 'InvalidApiKey',
        providerRequestId: 'header-request-id',
      },
    });
    expect(error.details.safeMessage).toContain('Bearer [REDACTED]');
    expect(error.details.safeMessage).toContain('api_key=[REDACTED]');
    expect(error.details.safeMessage).not.toContain('secret-token');
    expect(error.details.safeMessage).not.toContain('private-key');
    expect(error.details.safeMessage?.length).toBeLessThanOrEqual(256);
  });

  it('marks temporary image HTTP failures separately', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://x.aliyuncs.com/a' }] }), {
          headers: { 'x-request-id': 'bailian-request-1' },
        }),
      )
      .mockResolvedValueOnce(new Response('bad', { status: 502 }));
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject: vi.fn().mockResolvedValue({}) },
    });
    await expect(
      new BailianImageProvider('secret', 'https://api.example.com', storage, fetcher).generate(
        input,
      ),
    ).rejects.toMatchObject({ details: { stage: 'TEMPORARY_IMAGE_DOWNLOAD', httpStatus: 502 } });
  });

  it('preserves temporary download stage on an abort timeout', async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://x.aliyuncs.com/a' }] }), {
          headers: { 'x-request-id': 'bailian-request-1' },
        }),
      )
      .mockImplementationOnce(() => {
        controller.abort();
        throw new DOMException('timeout', 'TimeoutError');
      });
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject: vi.fn().mockResolvedValue({}) },
    });

    await expect(
      new BailianImageProvider('secret', 'https://api.example.com', storage, fetcher).generate({
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_TIMEOUT',
      details: { stage: 'TEMPORARY_IMAGE_DOWNLOAD' },
    });
  });

  it('marks MIME validation failures separately', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://x.aliyuncs.com/a' }] })),
      )
      .mockResolvedValueOnce(
        new Response('not png', { status: 200, headers: { 'content-type': 'text/plain' } }),
      );
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject: vi.fn().mockResolvedValue({}) },
    });
    await expect(
      new BailianImageProvider('secret', 'https://api.example.com', storage, fetcher).generate(
        input,
      ),
    ).rejects.toMatchObject({ details: { stage: 'VALIDATION' } });
  });

  it('marks BOS failures separately and preserves provider timeout semantics', async () => {
    const putObject = vi.fn().mockRejectedValue({ code: 'AccountOverdue', statusCode: 403 });
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://x.aliyuncs.com/a' }] }), {
          headers: { 'x-request-id': 'bailian-request-1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }),
      );
    await expect(
      new BailianImageProvider('secret', 'https://api.example.com', storage, fetcher).generate(
        input,
      ),
    ).rejects.toMatchObject({
      details: {
        stage: 'BOS_UPLOAD',
        httpStatus: 403,
        providerErrorCode: 'AccountOverdue',
        providerRequestId: 'bailian-request-1',
      },
    });

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const controller = new AbortController();
    controller.abort();
    await expect(
      new BailianImageProvider(
        'secret',
        'https://api.example.com',
        storage,
        timeoutFetcher,
      ).generate({
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_TIMEOUT' });
  });

  it('marks initial Bailian request timeouts as BAILIAN_REQUEST', async () => {
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com',
      client: { putObject: vi.fn().mockResolvedValue({}) },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      new BailianImageProvider(
        'secret',
        'https://api.example.com',
        storage,
        vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timeout', 'TimeoutError')),
      ).generate({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'IMAGE_PROVIDER_TIMEOUT',
      details: { stage: 'BAILIAN_REQUEST' },
    });
  });
});
