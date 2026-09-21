import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ratePolicy, type RateLimitStore } from '../src/security/rate-limit.js';
import { safeLoggerOptions } from '../src/security/logging.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('server abuse controls', () => {
  it('limits authentication by trusted socket identity, ignoring spoofed forwarded headers', async () => {
    const counts = new Map<string, number>();
    const store: RateLimitStore = {
      consume: (key) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return Promise.resolve(next);
      },
    };
    const app = buildApp({ logger: false, rateLimitStore: store });
    apps.push(app);
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/staff/auth/login',
        headers: { 'x-forwarded-for': String(i) },
      });
      expect(response.statusCode).toBe(404); // route not registered; hook runs first
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      headers: { 'x-forwarded-for': 'fresh-client' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string; requestId: string } }>().error.code).toBe(
      'RATE_LIMITED',
    );
    expect(
      blocked.json<{ error: { code: string; requestId: string } }>().error.requestId,
    ).toBeTypeOf('string');
    expect(blocked.headers['retry-after']).toBe('60');
    expect(counts.size).toBe(1);
  });
  it('fails closed for protected writes on store failure and leaves reads available', async () => {
    const app = buildApp({
      logger: false,
      rateLimitStore: {
        consume: () => Promise.reject(new Error('redis secret')),
      },
    });
    apps.push(app);
    const denied = await app.inject({ method: 'POST', url: '/api/v1/franchise/applications' });
    expect(denied.statusCode).toBe(503);
    expect(denied.body).not.toContain('redis secret');
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
  it('classifies AI writes and password resets without limiting reads', () => {
    expect(ratePolicy('POST', '/api/v1/ai/story/works')?.name).toBe('ai-write');
    expect(ratePolicy('POST', '/api/v1/staff/admin/accounts/abc/reset-password')?.name).toBe(
      'password-reset',
    );
    expect(ratePolicy('GET', '/api/v1/ai/story/works')).toBeNull();
  });
  it('returns opaque errors for unhandled exceptions', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    app.get('/unsafe-test', () => {
      throw new Error('SQL token password');
    });
    const response = await app.inject({ method: 'GET', url: '/unsafe-test?code=private' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('SQL token password');
    expect(response.json<{ error: { code: string; requestId: string } }>().error).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: response.headers['x-request-id'],
    });
  });
  it('does not accept caller-chosen request IDs for audit correlation', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'spoofed-audit-id' },
    });
    expect(response.headers['x-request-id']).not.toBe('spoofed-audit-id');
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });
});

describe('log privacy', () => {
  it('serializes requests without URL, headers, query or body', () => {
    const serialize = safeLoggerOptions.serializers!.req!;
    expect(
      serialize({
        id: 'r1',
        method: 'POST',
        url: '/?code=secret',
        headers: { authorization: 'Bearer secret' },
        body: { password: 'secret' },
      }),
    ).toEqual({ id: 'r1', method: 'POST' });
    expect(safeLoggerOptions.serializers!.err!(new Error('secret'))).toBe('[REDACTED]');
    expect(safeLoggerOptions.redact).toBeDefined();
  });
});
