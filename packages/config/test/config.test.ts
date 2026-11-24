import { describe, expect, it } from 'vitest';
import {
  IMAGE_PROVIDER_MIN_TIMEOUT_MS,
  IMAGE_REFERENCE_EXPIRY_MARGIN_MS,
  PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS,
  assertBeijingImageWorkspaceEndpoint,
  assertImageReferenceLifetime,
  loadDatabaseConfig,
  loadServiceConfig,
  loadWorkerConfig,
} from '../src/index.js';

describe('environment isolation foundation', () => {
  it('rejects unknown environments', () =>
    expect(() => loadServiceConfig({ APP_ENV: 'preview' })).toThrow());
  it('requires a PostgreSQL URL', () =>
    expect(() => loadDatabaseConfig({ APP_ENV: 'dev', DATABASE_URL: 'sqlite://local' })).toThrow());
});

const workspace = 'ws-benchmark123';
const approvedEndpoint = 'https://ws-benchmark123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const baseImageEnv = {
  APP_ENV: 'dev',
  PICTURE_BOOK_IMAGE_ENABLED: 'true',
  PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
  PICTURE_BOOK_IMAGE_MODEL: 'qwen-image-3.0',
  PICTURE_BOOK_IMAGE_TIMEOUT_MS: '600000',
  PICTURE_BOOK_IMAGE_BASE_URL: approvedEndpoint,
  DASHSCOPE_WORKSPACE_ID: workspace,
};
const workerEnv = {
  ...baseImageEnv,
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic',
  REDIS_URL: 'redis://127.0.0.1:6379',
  AI_PROVIDER: 'MOCK',
  AI_MOCK_ENABLED: 'true',
  DASHSCOPE_API_KEY: 'synthetic-key',
  BAIDU_BOS_ENDPOINT: 'https://cd.bcebos.com',
  BAIDU_BOS_BUCKET: 'synthetic-private-bucket',
  BAIDU_BOS_PUBLIC_ORIGIN: 'https://synthetic-private-bucket.cd.bcebos.com',
  BAIDU_BOS_ACCESS_KEY_ID: 'synthetic-ak',
  BAIDU_BOS_SECRET_ACCESS_KEY: 'synthetic-sk',
};
const serviceEnv = {
  ...baseImageEnv,
  WECHAT_APP_ID: 'synthetic-appid',
  WECHAT_APP_SECRET: 'synthetic-secret',
  CONSUMER_SESSION_SECRET: 'a'.repeat(32),
  STAFF_SESSION_SECRET: 'b'.repeat(32),
  REDIS_URL: 'redis://127.0.0.1:6379',
};

describe('#111 Beijing image workspace and private reference lifetime', () => {
  it('accepts only the exact Beijing workspace image endpoint', () => {
    expect(() => assertBeijingImageWorkspaceEndpoint(workspace, approvedEndpoint)).not.toThrow();
    expect(loadServiceConfig(serviceEnv).PICTURE_BOOK_IMAGE_MODEL).toBe('qwen-image-3.0');
    expect(loadWorkerConfig(workerEnv).PICTURE_BOOK_IMAGE_MODEL).toBe('qwen-image-3.0');
  });

  it('fails closed on wrong or missing workspace, region, path, query and credentials', () => {
    const rejected = [
      [undefined, approvedEndpoint],
      ['ws-another123', approvedEndpoint],
      [workspace, undefined],
      [workspace, 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
      [workspace, approvedEndpoint.replace('cn-beijing', 'cn-shanghai')],
      [workspace, approvedEndpoint + '/'],
      [workspace, approvedEndpoint + '?override=1'],
      [workspace, approvedEndpoint.replace('maas.aliyuncs.com/', 'maas.aliyuncs.com:8443/')],
      [workspace, approvedEndpoint.replace('https://', 'https://username@')],
    ] as const;
    for (const [ws, endpoint] of rejected) {
      expect(() => assertBeijingImageWorkspaceEndpoint(ws, endpoint)).toThrow(
        'IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH',
      );
    }
    expect(() =>
      loadWorkerConfig({ ...workerEnv, DASHSCOPE_WORKSPACE_ID: 'ws-another123' }),
    ).toThrow('IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH');
    expect(() =>
      loadServiceConfig({ ...serviceEnv, PICTURE_BOOK_IMAGE_BASE_URL: approvedEndpoint + '?x=1' }),
    ).toThrow('IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH');
  });

  it('keeps signed references valid beyond the effective 600s provider deadline', () => {
    expect(PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS).toBe(900);
    expect(IMAGE_PROVIDER_MIN_TIMEOUT_MS).toBe(600_000);
    expect(IMAGE_REFERENCE_EXPIRY_MARGIN_MS).toBe(120_000);
    expect(() => assertImageReferenceLifetime(600_000)).not.toThrow();
    expect(() => assertImageReferenceLifetime(780_000)).not.toThrow();
    expect(() => assertImageReferenceLifetime(780_001)).toThrow(
      'IMAGE_REFERENCE_TTL_TIMEOUT_MISMATCH',
    );
    expect(() =>
      loadWorkerConfig({ ...workerEnv, PICTURE_BOOK_IMAGE_TIMEOUT_MS: '900000' }),
    ).toThrow('IMAGE_REFERENCE_TTL_TIMEOUT_MISMATCH');
    expect(() =>
      loadServiceConfig({ ...serviceEnv, PICTURE_BOOK_IMAGE_TIMEOUT_MS: '900000' }),
    ).toThrow('IMAGE_REFERENCE_TTL_TIMEOUT_MISMATCH');
  });

  it('leaves ordinary disabled image services compatible with previous defaults', () => {
    const disabled = loadServiceConfig({
      ...serviceEnv,
      PICTURE_BOOK_IMAGE_ENABLED: 'false',
      PICTURE_BOOK_IMAGE_BASE_URL: undefined,
      DASHSCOPE_WORKSPACE_ID: undefined,
    });
    expect(disabled.PICTURE_BOOK_IMAGE_ENABLED).toBe(false);
  });
});

describe('#208 default-disabled food stock writes', () => {
  it('requires the literal true string and never coerces a false string into permission', () => {
    expect(loadServiceConfig(serviceEnv).FOOD_STOCK_WRITES_ENABLED).toBe(false);
    expect(
      loadServiceConfig({ ...serviceEnv, FOOD_STOCK_WRITES_ENABLED: 'false' })
        .FOOD_STOCK_WRITES_ENABLED,
    ).toBe(false);
    expect(
      loadServiceConfig({ ...serviceEnv, FOOD_STOCK_WRITES_ENABLED: 'true' })
        .FOOD_STOCK_WRITES_ENABLED,
    ).toBe(true);
    for (const value of ['1', 'TRUE', 'yes', ''])
      expect(() =>
        loadServiceConfig({ ...serviceEnv, FOOD_STOCK_WRITES_ENABLED: value }),
      ).toThrow();
  });
});

describe('#208 checkout activation requires both explicit gates', () => {
  it('keeps checkout false by default and rejects partial or malformed activation', () => {
    expect(loadServiceConfig(serviceEnv).FOOD_CHECKOUT_ENABLED).toBe(false);
    expect(() => loadServiceConfig({ ...serviceEnv, FOOD_CHECKOUT_ENABLED: 'true' })).toThrow(
      'FOOD_CHECKOUT_REQUIRES_STOCK_WRITES',
    );
    expect(
      loadServiceConfig({
        ...serviceEnv,
        FOOD_CHECKOUT_ENABLED: 'true',
        FOOD_STOCK_WRITES_ENABLED: 'true',
      }).FOOD_CHECKOUT_ENABLED,
    ).toBe(true);
    for (const value of ['false', 'true'])
      expect(
        loadServiceConfig({
          ...serviceEnv,
          FOOD_STOCK_WRITES_ENABLED: 'true',
          FOOD_CHECKOUT_ENABLED: value,
        }).FOOD_CHECKOUT_ENABLED,
      ).toBe(value === 'true');
    expect(() =>
      loadServiceConfig({
        ...serviceEnv,
        FOOD_STOCK_WRITES_ENABLED: 'true',
        FOOD_CHECKOUT_ENABLED: '1',
      }),
    ).toThrow();
  });
});
