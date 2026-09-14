import type { WeChatLoginResponse } from '@xiaohai/contracts';
import type { ConsumerIdentityRepository } from './consumer-repository.js';
import type { ConsumerSessionService } from './session.js';
import type { WeChatAuthProvider } from './wechat-provider.js';

export class ConsumerAuthService {
  constructor(
    private readonly appId: string,
    private readonly provider: WeChatAuthProvider,
    private readonly repository: ConsumerIdentityRepository,
    private readonly sessions: ConsumerSessionService,
  ) {}

  async login(code: string): Promise<WeChatLoginResponse> {
    const wechat = await this.provider.codeToSession(code);
    const identity = await this.repository.findOrCreateWechatIdentity({
      appId: this.appId,
      openid: wechat.openid,
      unionid: wechat.unionid,
    });
    const session = this.sessions.issue(identity.consumerUserId);
    return {
      consumer: { id: identity.consumerUserId },
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
    };
  }
}
