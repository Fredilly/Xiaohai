import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '@xiaohai/config';

describe('worker foundation', () => {
  it('accepts an isolated development environment', () => {
    expect(
      loadWorkerConfig({
        APP_ENV: 'dev',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://u:p@localhost/db',
        REDIS_URL: 'redis://localhost:6379',
        AI_PROVIDER: 'MOCK',
        AI_MOCK_ENABLED: 'true',
      }).APP_ENV,
    ).toBe('dev');
  });
});
