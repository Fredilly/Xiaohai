import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { RedisRateLimitStore } from '../src/security/rate-limit.js';

const integration = process.env.REDIS_URL ? describe : describe.skip;
integration('Redis security limiter', () => {
  it('atomically rejects requests shared by concurrent API instances', async () => {
    const stores = [
      new RedisRateLimitStore(process.env.REDIS_URL!),
      new RedisRateLimitStore(process.env.REDIS_URL!),
    ];
    const apps = [
      buildApp({ logger: false, rateLimitStore: stores[0]! }),
      buildApp({ logger: false, rateLimitStore: stores[1]! }),
    ];
    try {
      // Separate app instances use separate Redis clients but share the same Redis counter.
      const responses = await Promise.all(
        Array.from({ length: 15 }, (_, index) =>
          apps[index % 2]!.inject({
            method: 'POST',
            url: '/api/v1/franchise/applications',
            headers: { 'x-forwarded-for': String(index) },
          }),
        ),
      );
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(10);
      expect(responses.filter((response) => response.statusCode === 503)).toHaveLength(0);
    } finally {
      await Promise.all(apps.map((app) => app.close()));
      await Promise.all(stores.map((store) => store.close()));
    }
  });
});
