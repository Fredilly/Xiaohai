import { describe, expect, it, vi } from 'vitest';
import type { WeChatProviderError } from '../src/auth/errors.js';
import { HttpWeChatAuthProvider } from '../src/auth/wechat-provider.js';

describe('WeChat code2Session adapter', () => {
  it('maps a valid response without exposing session_key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ openid: 'openid-sensitive', session_key: 'never-return' })),
      );
    const provider = new HttpWeChatAuthProvider('app-id', 'secret', 500, fetcher);
    expect(await provider.codeToSession('temporary-code')).toEqual({
      openid: 'openid-sensitive',
      unionid: undefined,
    });
  });

  it('maps invalid codes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })));
    await expect(
      new HttpWeChatAuthProvider('app-id', 'secret', 500, fetcher).codeToSession('bad-code'),
    ).rejects.toMatchObject({ code: 'WECHAT_CODE_INVALID' } satisfies Partial<WeChatProviderError>);
  });

  it('maps provider failure and missing openid without leaking provider details', async () => {
    const failedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('network details'));
    await expect(
      new HttpWeChatAuthProvider('app-id', 'secret', 500, failedFetch).codeToSession('code'),
    ).rejects.toMatchObject({ code: 'WECHAT_PROVIDER_UNAVAILABLE' });

    const missingOpenid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ session_key: 'sensitive' })));
    await expect(
      new HttpWeChatAuthProvider('app-id', 'secret', 500, missingOpenid).codeToSession('code'),
    ).rejects.toMatchObject({ code: 'WECHAT_RESPONSE_INVALID' });
  });
});
