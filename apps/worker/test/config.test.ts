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

  it('requires BOS configuration only when Bailian image jobs are enabled', () => {
    const base = {
      APP_ENV: 'dev',
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      AI_PROVIDER: 'MOCK',
      AI_MOCK_ENABLED: 'true',
      PICTURE_BOOK_IMAGE_ENABLED: 'true',
      PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
      DASHSCOPE_API_KEY: 'test-only',
      DASHSCOPE_BASE_URL: 'https://workspace.example.com/compatible-mode/v1',
    };
    expect(() => loadWorkerConfig(base)).toThrow('Baidu BOS endpoint is required');
    expect(
      loadWorkerConfig({
        ...base,
        BAIDU_BOS_ENDPOINT: 'https://bj.bcebos.com',
        BAIDU_BOS_BUCKET: 'test-bucket',
        BAIDU_BOS_PUBLIC_ORIGIN: 'https://assets.example.com',
        BAIDU_BOS_ACCESS_KEY_ID: 'test-only',
        BAIDU_BOS_SECRET_ACCESS_KEY: 'test-only',
      }).PICTURE_BOOK_IMAGE_PROVIDER,
    ).toBe('BAILIAN');
  });
});
