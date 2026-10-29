import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { fail } from './commerce-routes.js';
import { CommerceError } from './commerce-service.js';

describe('Commerce API public error boundary', () => {
  it('never exposes arbitrary CommerceError or infrastructure exception messages', async () => {
    const app = Fastify({ logger: false });
    app.get('/conflict', (request, reply) =>
      fail(
        request,
        reply,
        new CommerceError('CONFLICT', 'Internal ISBN constraint: user@example.com / host=db.prod'),
      ),
    );
    app.get('/invalid', (request, reply) =>
      fail(request, reply, new CommerceError('INVALID_INPUT', 'Private business-only detail')),
    );
    app.get('/internal', (request, reply) =>
      fail(request, reply, new Error('DATABASE_URL=postgresql://internal-secret')),
    );
    try {
      const expected = [
        ['/conflict', 409, 'CONFLICT', 'Commerce conflict'],
        ['/invalid', 400, 'INVALID_INPUT', 'Invalid catalog update'],
        ['/internal', 500, 'INTERNAL_ERROR', 'Internal server error'],
      ] as const;
      for (const [url, status, code, message] of expected) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(status);
        const body = response.json<{
          error: { code: string; message: string; requestId: string };
        }>();
        expect(body.error).toMatchObject({ code, message });
        expect(body.error.requestId).toBeTruthy();
        expect(response.body).not.toContain('db.prod');
        expect(response.body).not.toContain('Private business-only detail');
        expect(response.body).not.toContain('internal-secret');
      }
    } finally {
      await app.close();
    }
  });
});
