import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('foundation health endpoint', () => {
  it('returns a request id and service health without business data', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'api' });
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });

  it('serves the deterministic local MOCK image without external storage', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dev/mock-images/fixture.jpg',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(response.rawPayload).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
});
