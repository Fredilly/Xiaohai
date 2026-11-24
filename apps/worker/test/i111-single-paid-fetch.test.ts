import { describe, expect, it, vi } from 'vitest';
import { BosStorage } from '../src/bos-storage.js';
import { BailianImageProvider } from '../src/image-provider.js';
import { createI111SinglePaidFetch } from '../src/i111-single-paid-fetch.js';

const workspaceId = 'ws-31e71dbr72cfr5th';
const baseUrl = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`;
const endpoint = `${baseUrl}/images/generations`;
const download = 'https://result.oss-cn-beijing.aliyuncs.com/temporary.png';
const origin = 'https://xiaohai-i111-work-2ec3900280.cd.bcebos.com';
const references = [
  `${origin}/picture-books/character-references/i111/first.png?signature=placeholder`,
  'https://cd.bcebos.com/xiaohai-i111-work-2ec3900280/picture-books/character-references/i111/second.png?signature=placeholder',
];

const paid = (changes: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen-image-3.0',
    prompt: 'One isolated image',
    image: references,
    n: 1,
    size: '1024x1024',
    ...changes,
  }),
});

const harness = (
  handler: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 })),
) => {
  const fetcher = vi.fn<typeof fetch>(handler);
  const guard = createI111SinglePaidFetch({ workspaceId, fetcher });
  return { guard, fetcher };
};

describe('I111 native one-use provider transport', () => {
  it('permits the two real BOS signer URL forms and one paid POST plus one image GET', async () => {
    const { guard, fetcher } = harness();
    await guard.fetcher(endpoint, paid());
    await guard.fetcher(download, { redirect: 'error' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', method: 'POST' });
    expect(guard.usageSummary()).toEqual({
      paidPostConsumed: true,
      paidPostSucceeded: true,
      imageDownloadConsumed: true,
      paidExecutionAuthorized: false,
    });
    await expect(guard.fetcher(endpoint, paid())).rejects.toThrow('I111_IMAGE_TRANSPORT_STOP');
    await expect(guard.fetcher(download, { redirect: 'error' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong model, region, n, size, reference host or unsigned/missing images', async () => {
    for (const [url, init] of [
      [endpoint, paid({ model: 'qwen-image-3.0-pro' })],
      [endpoint, paid({ n: 2 })],
      [endpoint, paid({ size: '2048x2048' })],
      [endpoint, paid({ image: references.slice(0, 1) })],
      [endpoint, paid({ image: [references[0], references[0]] })],
      [
        endpoint,
        paid({ image: [references[0], `${origin}/picture-books/character-references/i111/2.png`] }),
      ],
      [endpoint, paid({ image: [references[0], 'https://evil.invalid/img.png'] })],
      [endpoint, paid({ image: [references[0], 'http://cd.bcebos.com/other.png'] })],
      [endpoint, paid({ extra: 'forbidden' })],
      [endpoint, paid({ prompt: '' })],
      [endpoint.replace('cn-beijing', 'ap-southeast'), paid()],
      [endpoint, { ...paid(), method: 'GET' }],
    ] as Array<[string, RequestInit]>) {
      const { guard, fetcher } = harness();
      await expect(guard.fetcher(url, init)).rejects.toThrow('I111_IMAGE_TRANSPORT_STOP');
      await expect(guard.fetcher(endpoint, paid())).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('burns its POST allowance on timeout or unknown outcome', async () => {
    const { guard, fetcher } = harness(() => Promise.reject(new Error('secret error content')));
    await expect(guard.fetcher(endpoint, paid())).rejects.toThrow('I111_IMAGE_TRANSPORT_STOP');
    await expect(guard.fetcher(endpoint, paid())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(guard.usageSummary().paidPostConsumed).toBe(true);
  });

  it('rejects a second download, unsafe redirects and any second POST', async () => {
    for (const [url, init] of [
      [download, { redirect: 'follow' }],
      [download, { redirect: 'error', method: 'POST' }],
      ['https://untrusted.invalid/img.png', { redirect: 'error' }],
      ['not-a-url', { redirect: 'error' }],
    ] as Array<[string, RequestInit]>) {
      const { guard, fetcher } = harness();
      await guard.fetcher(endpoint, paid());
      await expect(guard.fetcher(url, init)).rejects.toThrow('I111_IMAGE_TRANSPORT_STOP');
      await expect(guard.fetcher(download, { redirect: 'error' })).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry an unsuccessful POST or failed image download', async () => {
    const blocked = harness(() => Promise.resolve(new Response('{}', { status: 429 })));
    const response = await blocked.guard.fetcher(endpoint, paid());
    expect(response.status).toBe(429);
    await expect(blocked.guard.fetcher(download, { redirect: 'error' })).rejects.toThrow();
    expect(blocked.fetcher).toHaveBeenCalledTimes(1);

    const broken = harness((url) => {
      if (url === endpoint) return Promise.resolve(new Response('{}', { status: 200 }));
      return Promise.reject(new Error('private download failure'));
    });
    await broken.guard.fetcher(endpoint, paid());
    await expect(broken.guard.fetcher(download, { redirect: 'error' })).rejects.toThrow();
    await expect(broken.guard.fetcher(download, { redirect: 'error' })).rejects.toThrow();
    expect(broken.fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed workspaces and non-fetch dependencies', () => {
    for (const id of ['', 'other', 'ws-1234', 'ws-../secret', 'ws-ABCDEF12345678']) {
      expect(() => createI111SinglePaidFetch({ workspaceId: id, fetcher: fetch })).toThrow();
    }
    expect(() => createI111SinglePaidFetch({ workspaceId, fetcher: null as never })).toThrow();
  });

  it('wires into the REAL BailianImageProvider -> download -> BOS storage path (mocked I/O)', async () => {
    const putObject = vi.fn().mockResolvedValue({});
    const storage = new BosStorage({
      bucket: 'xiaohai-i111-work-2ec3900280',
      publicOrigin: origin,
      client: { putObject },
    });
    const { guard, fetcher } = harness((url) =>
      Promise.resolve(
        url === endpoint
          ? new Response(JSON.stringify({ data: [{ url: download }] }), {
              status: 200,
              headers: { 'x-request-id': 'fictional-request-id' },
            })
          : new Response(Buffer.from('png'), {
              status: 200,
              headers: { 'content-type': 'image/png' },
            }),
      ),
    );
    const provider = new BailianImageProvider(
      'fake-local-test-key',
      baseUrl,
      storage,
      guard.fetcher,
    );
    const result = await provider.generate({
      generationKey: '11111111-2222-4333-8444-555555555555',
      model: 'qwen-image-3.0',
      prompt: 'Fictional illustration',
      consistency: [],
      referenceImages: references,
      signal: new AbortController().signal,
    });
    expect(result.assetProvider).toBe('BAIDU_BOS');
    expect(putObject).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(guard.usageSummary()).toMatchObject({
      paidPostConsumed: true,
      paidPostSucceeded: true,
      imageDownloadConsumed: true,
    });
    await expect(
      provider.generate({
        generationKey: 'another-id',
        model: 'qwen-image-3.0',
        prompt: 'no second attempt',
        consistency: [],
        referenceImages: references,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
