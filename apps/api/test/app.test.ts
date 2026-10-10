import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
});

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
    vi.stubEnv('NODE_ENV', 'test');
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

  it('does not expose the fixture in production, even with the dev flag', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MOCK_IMAGE_DEV_ROUTE_ENABLED', 'true');
    const app = buildApp({ logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dev/mock-images/fixture.jpg',
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires an explicit opt-in for development MOCK images', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_IMAGE_DEV_ROUTE_ENABLED', 'false');
    const disabledApp = buildApp({ logger: false });
    apps.push(disabledApp);
    expect(
      (await disabledApp.inject({ method: 'GET', url: '/api/v1/dev/mock-images/fixture.jpg' }))
        .statusCode,
    ).toBe(404);

    vi.stubEnv('MOCK_IMAGE_DEV_ROUTE_ENABLED', 'true');
    const enabledApp = buildApp({ logger: false });
    apps.push(enabledApp);
    expect(
      (await enabledApp.inject({ method: 'GET', url: '/api/v1/dev/mock-images/fixture.jpg' }))
        .statusCode,
    ).toBe(200);
  });
});
