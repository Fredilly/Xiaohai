import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ConsumerAuthService } from '../src/auth/consumer-auth-service.js';
import type { ConsumerIdentityRepository } from '../src/auth/consumer-repository.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import type { WeChatAuthProvider } from '../src/auth/wechat-provider.js';
import { registerCommerceRoutes } from '../src/commerce/commerce-routes.js';
import type { CommerceService } from '../src/commerce/commerce-service.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';

const consumerA = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105b';
const consumerB = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105c';
const secret = 'isolated-http-session-test-only-secret-32-bytes';
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/**
 * Real Fastify route/HTTP injection and real HMAC-signed ConsumerSessionService.
 * No shared DB, WeChat credentials, external network, or staging TTL changes.
 * Only identity lookup and cart persistence are test doubles.
 */
function fixture() {
  let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
  const sessions = new ConsumerSessionService(secret, 60, () => new Date(nowMs));
  const provider: WeChatAuthProvider = {
    codeToSession: vi.fn((code: string) =>
      Promise.resolve({
        openid: code === 'test-code-b' ? 'isolated-openid-b' : 'isolated-openid-a',
      }),
    ),
  };
  const repository: ConsumerIdentityRepository = {
    findOrCreateWechatIdentity: vi.fn(({ openid }) =>
      Promise.resolve({
        consumerUserId: openid === 'isolated-openid-b' ? consumerB : consumerA,
        wechatIdentityId:
          openid === 'isolated-openid-b'
            ? '018f0f7f-17e7-7d50-8a4a-1cf31eb8106c'
            : '018f0f7f-17e7-7d50-8a4a-1cf31eb8106b',
      }),
    ),
  };
  const consumerAuth = new ConsumerAuthService('isolated-app', provider, repository, sessions);
  const getCart = vi.fn((id: string) =>
    Promise.resolve({
      items: [],
      subtotalMinor: 0,
      consumerUserId: id,
    }),
  );
  const app = buildApp({ consumerAuth, logger: false });
  apps.push(app);
  registerCommerceRoutes(app, {
    commerce: { getCart } as unknown as CommerceService,
    consumerSessions: sessions,
    // None of the exercised Consumer routes use Staff authorization.
    staffAuthorization: {} as StaffAuthorizationService,
  });

  async function login(code = 'test-code-a') {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat/login',
      payload: { code },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      consumer: { id: string };
      session: { token: string; expiresAt: string };
    }>();
    expect(data.session.token).toContain('.');
    return data;
  }

  async function getProtectedCart(token?: string, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/commerce/cart',
      headers: { ...headers, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    });
  }

  return {
    login,
    getProtectedCart,
    getCart,
    setClock: (elapsedSeconds: number) => {
      nowMs = Date.parse('2026-01-01T00:00:00.000Z') + elapsedSeconds * 1000;
    },
  };
}

describe('consumer signed session, protected HTTP route and expiry (#116)', () => {
  it('accepts server-issued token before expiry and returns 401 at the exact exp boundary', async () => {
    const fx = fixture();
    const result = await fx.login();
    expect(result.consumer.id).toBe(consumerA);
    expect(result.session.expiresAt).toBe('2026-01-01T00:01:00.000Z');

    fx.setClock(59);
    const before = await fx.getProtectedCart(result.session.token);
    expect(before.statusCode).toBe(200);
    expect(before.json<{ consumerUserId: string }>().consumerUserId).toBe(consumerA);
    expect(fx.getCart).toHaveBeenCalledExactlyOnceWith(consumerA);

    fx.setClock(60);
    const expired = await fx.getProtectedCart(result.session.token);
    expect(expired.statusCode).toBe(401);
    expect(expired.json<{ error: { code: string } }>().error.code).toBe(
      'CONSUMER_AUTHENTICATION_REQUIRED',
    );
    // No cart data may be looked up or returned after expiry.
    expect(expired.body).not.toContain(consumerA);
    expect(expired.body).not.toContain(result.session.token);
    expect(fx.getCart).toHaveBeenCalledTimes(1);

    fx.setClock(61);
    const later = await fx.getProtectedCart(result.session.token);
    expect(later.statusCode).toBe(401);
    expect(fx.getCart).toHaveBeenCalledTimes(1);
  });

  it('uses the signed identity, never a caller-supplied consumer header', async () => {
    const fx = fixture();
    const sessionA = await fx.login('test-code-a');
    const sessionB = await fx.login('test-code-b');
    const responseA = await fx.getProtectedCart(sessionA.session.token, {
      'x-consumer-user-id': consumerB,
    });
    const responseB = await fx.getProtectedCart(sessionB.session.token, {
      'x-consumer-user-id': consumerA,
    });

    expect(responseA.statusCode).toBe(200);
    expect(responseB.statusCode).toBe(200);
    expect(responseA.json<{ consumerUserId: string }>().consumerUserId).toBe(consumerA);
    expect(responseB.json<{ consumerUserId: string }>().consumerUserId).toBe(consumerB);
    expect(fx.getCart.mock.calls.map(([id]) => id)).toEqual([consumerA, consumerB]);
  });

  it('rejects missing, malformed and tampered tokens without reading protected data', async () => {
    const fx = fixture();
    const session = await fx.login();
    for (const token of [
      undefined,
      '',
      'garbage',
      `${session.session.token}changed`,
      `${session.session.token.split('.')[0]}.invalid-signature`,
    ]) {
      const response = await fx.getProtectedCart(token);
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain(session.session.token);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        'CONSUMER_AUTHENTICATION_REQUIRED',
      );
    }
    expect(fx.getCart).not.toHaveBeenCalled();
  });
});
