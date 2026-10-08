import { appEnvironmentSchema, logLevelSchema } from '@xiaohai/validation';
import { z } from 'zod';

const baseSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('dev'),
  LOG_LEVEL: logLevelSchema.default('info'),
});
const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalHttpsUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url().startsWith('https://').optional(),
);
const serviceSchema = baseSchema.extend({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WECHAT_APP_ID: z.string().min(1),
  WECHAT_APP_SECRET: z.string().min(1),
  WECHAT_AUTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  CONSUMER_SESSION_SECRET: z.string().min(32),
  CONSUMER_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(604_800),
  STAFF_SESSION_SECRET: z.string().min(32),
  STAFF_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(28_800),
  RENTAL_LOAN_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  PICKUP_CODE_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  DELIVERY_PROVIDER: z.enum(['MANUAL']).default('MANUAL'),
  REDIS_URL: z.url().startsWith('redis://'),
  STORY_AI_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  STORY_AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK', 'BAILIAN', 'QWEN']).default('MOCK'),
  STORY_AI_MODEL: z.string().trim().min(1).max(128).default('qwen-flash'),
  STORY_AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  STORY_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  PICTURE_BOOK_AI_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  PICTURE_BOOK_AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK', 'BAILIAN']).default('MOCK'),
  PICTURE_BOOK_AI_MODEL: z.string().trim().min(1).max(128).default('mock-picture-book-v1'),
  PICTURE_BOOK_AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  PICTURE_BOOK_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  ANIMATION_AI_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ANIMATION_AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK', 'BAILIAN']).default('MOCK'),
  ANIMATION_AI_MODEL: z.string().trim().min(1).max(128).default('mock-animation-v1'),
  ANIMATION_AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ANIMATION_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  ANIMATION_VIDEO_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ANIMATION_VIDEO_PROVIDER: z.enum(['MOCK']).default('MOCK'),
  ANIMATION_VIDEO_MODEL: z.string().trim().min(1).max(128).default('mock-video-v1'),
  ANIMATION_VIDEO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  ANIMATION_MAX_GENERATIONS: z.coerce.number().int().min(1).max(1000).default(100),
  ANIMATION_MAX_COMPOSITIONS: z.coerce.number().int().min(1).max(100).default(10),
  ANIMATION_MAX_PLANNED_DURATION_MS: z.coerce.number().int().min(1000).max(3600000).default(600000),
  ANIMATION_COMPOSITION_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ANIMATION_COMPOSITION_PROVIDER: z.enum(['MOCK']).default('MOCK'),
  ANIMATION_COMPOSITION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  PICTURE_BOOK_IMAGE_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  PICTURE_BOOK_IMAGE_PROVIDER: z.enum(['MOCK', 'BAILIAN']).default('MOCK'),
  PICTURE_BOOK_IMAGE_MODEL: z.string().trim().min(1).max(128).default('mock-image-v1'),
  PICTURE_BOOK_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
});
const databaseSchema = baseSchema.extend({ DATABASE_URL: z.url().startsWith('postgresql://') });

export const loadServiceConfig = (env: NodeJS.ProcessEnv) => serviceSchema.parse(env);
const workerSchema = baseSchema.extend({
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z.url().startsWith('redis://'),
  AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK', 'BAILIAN', 'QWEN']).default('MOCK'),
  AI_MOCK_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().startsWith('https://').default('https://api.deepseek.com'),
  DASHSCOPE_API_KEY: optionalNonEmptyString,
  DASHSCOPE_WORKSPACE_ID: optionalNonEmptyString,
  DASHSCOPE_BASE_URL: optionalHttpsUrl,
  QWEN_BASE_URL: z
    .url()
    .startsWith('https://')
    .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  AI_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  PICTURE_BOOK_IMAGE_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  PICTURE_BOOK_IMAGE_PROVIDER: z.enum(['MOCK', 'BAILIAN']).default('MOCK'),
  PICTURE_BOOK_IMAGE_MODEL: z.string().trim().min(1).max(128).default('mock-image-v1'),
  PICTURE_BOOK_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  PICTURE_BOOK_IMAGE_BASE_URL: optionalHttpsUrl,
  BAIDU_BOS_ENDPOINT: optionalHttpsUrl,
  BAIDU_BOS_BUCKET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(3).max(63).optional(),
  ),
  BAIDU_BOS_PUBLIC_ORIGIN: optionalHttpsUrl,
  BAIDU_BOS_ACCESS_KEY_ID: optionalNonEmptyString,
  BAIDU_BOS_SECRET_ACCESS_KEY: optionalNonEmptyString,
  ANIMATION_VIDEO_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ANIMATION_VIDEO_PROVIDER: z.enum(['MOCK']).default('MOCK'),
  ANIMATION_VIDEO_MODEL: z.string().trim().min(1).max(128).default('mock-video-v1'),
  ANIMATION_VIDEO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  ANIMATION_COMPOSITION_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  ANIMATION_COMPOSITION_PROVIDER: z.enum(['MOCK']).default('MOCK'),
  ANIMATION_COMPOSITION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
});
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => {
  const config = workerSchema.parse(env);
  if (config.AI_PROVIDER === 'MOCK' && !config.AI_MOCK_ENABLED)
    throw new Error('AI Mock Provider is disabled');
  if (config.AI_PROVIDER === 'DEEPSEEK' && !config.DEEPSEEK_API_KEY)
    throw new Error('DeepSeek API key is required');
  if (config.AI_PROVIDER === 'BAILIAN' && !config.DASHSCOPE_API_KEY)
    throw new Error('Bailian API key is required');
  if (config.AI_PROVIDER === 'BAILIAN' && !config.DASHSCOPE_BASE_URL)
    throw new Error('Bailian base URL is required');
  if (config.AI_PROVIDER === 'QWEN' && !config.DASHSCOPE_API_KEY)
    throw new Error('Qwen API key is required');
  if (config.PICTURE_BOOK_IMAGE_ENABLED && config.PICTURE_BOOK_IMAGE_PROVIDER === 'BAILIAN') {
    if (!config.DASHSCOPE_API_KEY) throw new Error('Bailian API key is required for image jobs');
    if (config.PICTURE_BOOK_IMAGE_MODEL.startsWith('qwen-image-3.0')) {
      if (!config.PICTURE_BOOK_IMAGE_BASE_URL ||
          !new URL(config.PICTURE_BOOK_IMAGE_BASE_URL).pathname.replace(/\\/$/, '').endsWith('/compatible-mode/v1'))
        throw new Error('Qwen Image 3.0 requires PICTURE_BOOK_IMAGE_BASE_URL with a region-matched workspace endpoint ending in /compatible-mode/v1');
    } else if (!config.PICTURE_BOOK_IMAGE_BASE_URL && !config.DASHSCOPE_BASE_URL) {
      throw new Error('Bailian image base URL is required');
    }
    if (!config.BAIDU_BOS_ENDPOINT) throw new Error('Baidu BOS endpoint is required');
    if (!config.BAIDU_BOS_BUCKET) throw new Error('Baidu BOS bucket is required');
    if (!config.BAIDU_BOS_PUBLIC_ORIGIN) throw new Error('Baidu BOS public origin is required');
    if (!config.BAIDU_BOS_ACCESS_KEY_ID) throw new Error('Baidu BOS access key ID is required');
    if (!config.BAIDU_BOS_SECRET_ACCESS_KEY)
      throw new Error('Baidu BOS secret access key is required');
  }
  return config;
};
export const loadDatabaseConfig = (env: NodeJS.ProcessEnv) => databaseSchema.parse(env);
