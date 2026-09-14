import { PassThrough } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { apiErrorResponseSchema, staffLoginResponseSchema } from '@xiaohai/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { ConsumerAuthError } from '../src/auth/errors.js';
import type { StaffAuthService } from '../src/auth/staff-auth-service.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function setup(login: StaffAuthService['login'], loggerInstance?: FastifyBaseLogger) {
  const app = buildApp({
    staffAuth: { login } as StaffAuthService,
    logger: false,
    loggerInstance,
  });
  apps.push(app);
  return app;
}

describe('POST /api/v1/staff/auth/login', () => {
  it('returns only safe staff identity and session fields', async () => {
    const login = vi.fn().mockResolvedValue({
      staff: {
        id: '018f0f7f-17e7-7d50-8a4a-1cf31eb8105d',
        loginIdentifier: 'staff@example.com',
      },
      session: { token: 'safe-session-token', expiresAt: '2026-01-01T08:00:00.000Z' },
    });
    const response = await setup(login).inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { loginIdentifier: 'staff@example.com', password: 'correct-password' },
    });
    expect(response.statusCode).toBe(200);
    expect(staffLoginResponseSchema.parse(response.json())).toEqual(
      await login.mock.results[0]!.value,
    );
    expect(response.body).not.toContain('passwordHash');
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });

  it('strictly rejects client authorization claims', async () => {
    const login = vi.fn();
    const response = await setup(login).inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: {
        loginIdentifier: 'staff@example.com',
        password: 'correct-password',
        role: 'admin',
        permissions: ['*'],
        store_id: 'forged-store',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe('INVALID_REQUEST');
    expect(login).not.toHaveBeenCalled();
  });

  it('uses an indistinguishable public error and does not log credentials', async () => {
    const stream = new PassThrough();
    let logs = '';
    stream.on('data', (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) logs += chunk.toString();
    });
    const login = vi
      .fn()
      .mockRejectedValue(new ConsumerAuthError('STAFF_AUTHENTICATION_FAILED', 401));
    const response = await setup(login, pino({ level: 'info' }, stream)).inject({
      method: 'POST',
      url: '/api/v1/staff/auth/login',
      payload: { loginIdentifier: 'private-login', password: 'private-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      'STAFF_AUTHENTICATION_FAILED',
    );
    expect(logs).not.toContain('private-login');
    expect(logs).not.toContain('private-password');
    expect(logs).not.toContain('safe-session-token');
    expect(logs).not.toContain('passwordHash');
  });
});
