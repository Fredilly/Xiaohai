import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('operational readiness', () => {
  it('reports dependency failures without exposing infrastructure details', async () => {
    const app = buildApp({
      logger: false,
      readiness: vi.fn().mockRejectedValue(new Error('secret')),
    });
    const response = await app.inject('/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    expect(response.body).not.toContain('secret');
    await app.close();
  });

  it('keeps liveness separate from readiness', async () => {
    const app = buildApp({ logger: false, readiness: () => Promise.resolve(true) });
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/ready')).json()).toEqual({ status: 'ready' });
    await app.close();
  });
});
