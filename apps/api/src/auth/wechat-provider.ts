import { z } from 'zod';
import { WeChatProviderError } from './errors.js';

export interface WeChatSessionResult {
  openid: string;
  unionid?: string;
}

export interface WeChatAuthProvider {
  codeToSession(code: string): Promise<WeChatSessionResult>;
}

const wechatResponseSchema = z.object({
  openid: z.string().min(1).optional(),
  session_key: z.string().min(1).optional(),
  unionid: z.string().min(1).optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

const invalidCodeErrors = new Set([40029, 40163]);

export class HttpWeChatAuthProvider implements WeChatAuthProvider {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async codeToSession(code: string): Promise<WeChatSessionResult> {
    const endpoint = new URL('https://api.weixin.qq.com/sns/jscode2session');
    endpoint.searchParams.set('appid', this.appId);
    endpoint.searchParams.set('secret', this.appSecret);
    endpoint.searchParams.set('js_code', code);
    endpoint.searchParams.set('grant_type', 'authorization_code');

    let response: Response;
    try {
      response = await this.fetcher(endpoint, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new WeChatProviderError('WECHAT_PROVIDER_UNAVAILABLE', 502);
    }

    if (!response.ok) {
      throw new WeChatProviderError('WECHAT_PROVIDER_UNAVAILABLE', 502);
    }

    const parsed = wechatResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new WeChatProviderError('WECHAT_RESPONSE_INVALID', 502);
    }
    if (parsed.data.errcode !== undefined && parsed.data.errcode !== 0) {
      if (invalidCodeErrors.has(parsed.data.errcode)) {
        throw new WeChatProviderError('WECHAT_CODE_INVALID', 401);
      }
      throw new WeChatProviderError('WECHAT_PROVIDER_UNAVAILABLE', 502);
    }
    if (!parsed.data.openid) {
      throw new WeChatProviderError('WECHAT_RESPONSE_INVALID', 502);
    }

    return { openid: parsed.data.openid, unionid: parsed.data.unionid };
  }
}
