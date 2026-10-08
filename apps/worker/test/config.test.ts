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

  it('rejects Qwen Image 3.0 without an explicit workspace image endpoint', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      AI_PROVIDER: 'MOCK',
      AI_MOCK_ENABLED: 'true',
      PICTURE_BOOK_IMAGE_ENABLED: 'true',
      PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
      PICTURE_BOOK_IMAGE_MODEL: 'qwen-image-3.0',
      DASHSCOPE_API_KEY: 'test-only',
      DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    };
    expect(() => loadWorkerConfig(base)).toThrow('PICTURE_BOOK_IMAGE_BASE_URL');
    expect(() =>
      loadWorkerConfig({
        ...base,
        PICTURE_BOOK_IMAGE_BASE_URL: 'https://workspace.cn-beijing.maas.aliyuncs.com',
      }),
    ).toThrow('PICTURE_BOOK_IMAGE_BASE_URL');
    expect(() =>
      loadWorkerConfig({
        ...base,
        PICTURE_BOOK_IMAGE_BASE_URL:
          'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      }),
    ).toThrow('Baidu BOS endpoint is required');
  });

  it('loads Qwen through the DashScope key and configured OpenAI-compatible endpoint', () => {
    const base = {
      APP_ENV: 'dev',
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      AI_PROVIDER: 'QWEN',
    };

    expect(() => loadWorkerConfig(base)).toThrow('Qwen API key is required');

    expect(
      loadWorkerConfig({
        ...base,
        DASHSCOPE_API_KEY: 'test-only',
        QWEN_BASE_URL: 'https://dashscope.example.com/compatible-mode/v1',
      }),
    ).toMatchObject({
      AI_PROVIDER: 'QWEN',
      QWEN_BASE_URL: 'https://dashscope.example.com/compatible-mode/v1',
    });
  });
});
