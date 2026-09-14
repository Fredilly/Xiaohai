import { PassThrough } from 'node:stream';
import pino from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import { apiErrorResponseSchema } from '@xiaohai/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ConsumerAuthService } from '../src/auth/consumer-auth-service.js';
import type { ConsumerIdentityRepository } from '../src/auth/consumer-repository.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import { WeChatProviderError } from '../src/auth/errors.js';
import type { WeChatAuthProvider } from '../src/auth/wechat-provider.js';

const consumerUserId = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105b';
const identityId = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105c';
const secret = 'test-only-session-secret-at-least-32-characters';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function setup(
  provider: WeChatAuthProvider = {
    codeToSession: vi.fn().mockResolvedValue({ openid: 'server-openid', session_key: 'hidden' }),
  },
  loggerInstance?: FastifyBaseLogger,
) {
  const findOrCreateWechatIdentity = vi
    .fn()
    .mockResolvedValue({ consumerUserId, wechatIdentityId: identityId });
  const repository: ConsumerIdentityRepository = {
    findOrCreateWechatIdentity,
  };
  const service = new ConsumerAuthService(
    'server-app-id',
    provider,
    repository,
    new ConsumerSessionService(secret, 300, () => new Date('2026-01-01T00:00:00Z')),
  );
  const app = buildApp({ consumerAuth: service, logger: false, loggerInstance });
  apps.push(app);
  return { app, findOrCreateWechatIdentity };
}

describe('POST /api/v1/auth/wechat/login', () => {
  it('returns a safe consumer session and validates its response schema', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat/login',
      payload: { code: 'temporary-code' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      consumer: { id: consumerUserId },
      session: { expiresAt: '2026-01-01T00:05:00.000Z' },
    });
    expect(JSON.stringify(response.json())).not.toContain('session_key');
    expect(JSON.stringify(response.json())).not.toContain('server-openid');
  });

  it('rejects invalid request shapes and client-supplied openid', async () => {
    const { app, findOrCreateWechatIdentity } = setup();
    for (const payload of [{}, { code: '' }, { code: 'code', openid: 'forged-openid' }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/wechat/login',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json()).error).toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
    expect(findOrCreateWechatIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['WECHAT_CODE_INVALID', 401],
    ['WECHAT_PROVIDER_UNAVAILABLE', 502],
    ['WECHAT_RESPONSE_INVALID', 502],
  ] as const)('maps %s to a safe API error', async (code, statusCode) => {
    const provider: WeChatAuthProvider = {
      codeToSession: vi.fn().mockRejectedValue(new WeChatProviderError(code, statusCode)),
    };
    const { app } = setup(provider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat/login',
      payload: { code: 'sensitive-code' },
    });
    expect(response.statusCode).toBe(statusCode);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe(code);
    expect(error.requestId).toBeTypeOf('string');
  });

  it('maps database failures to a request-scoped internal error', async () => {
    const { app, findOrCreateWechatIdentity } = setup();
    findOrCreateWechatIdentity.mockRejectedValueOnce(
      new Error('database detail must stay private'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat/login',
      payload: { code: 'temporary-code' },
    });
    expect(response.statusCode).toBe(500);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Internal server error');
    expect(error.requestId).toBeTypeOf('string');
  });

  it('does not log code, openid, session_key, or secret on failures', async () => {
    const stream = new PassThrough();
    let logs = '';
    stream.on('data', (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) logs += chunk.toString();
    });
    const logger = pino({ level: 'info' }, stream);
    const provider: WeChatAuthProvider = {
      codeToSession: vi
        .fn()
        .mockRejectedValue(new WeChatProviderError('WECHAT_PROVIDER_UNAVAILABLE', 502)),
    };
    const { app } = setup(provider, logger);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat/login',
      payload: { code: 'code-must-not-log' },
    });
    expect(logs).not.toContain('code-must-not-log');
    expect(logs).not.toContain('server-openid');
    expect(logs).not.toContain('session_key');
    expect(logs).not.toContain(secret);
  });
});
