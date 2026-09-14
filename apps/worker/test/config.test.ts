import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '@xiaohai/config';

describe('worker foundation', () => {
  it('accepts an isolated development environment', () => {
    expect(loadWorkerConfig({ APP_ENV: 'dev', LOG_LEVEL: 'silent' }).APP_ENV).toBe('dev');
  });
});
