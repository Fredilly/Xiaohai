import { appEnvironmentSchema, logLevelSchema } from '@xiaohai/validation';
import { z } from 'zod';

const baseSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('dev'),
  LOG_LEVEL: logLevelSchema.default('info'),
});
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
  REDIS_URL: z.url().startsWith('redis://'),
  STORY_AI_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  STORY_AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK']).default('MOCK'),
  STORY_AI_MODEL: z.string().trim().min(1).max(128).default('mock-story-v1'),
  STORY_AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  STORY_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  PICTURE_BOOK_AI_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  PICTURE_BOOK_AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK']).default('MOCK'),
  PICTURE_BOOK_AI_MODEL: z.string().trim().min(1).max(128).default('mock-picture-book-v1'),
  PICTURE_BOOK_AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  PICTURE_BOOK_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
});
const databaseSchema = baseSchema.extend({ DATABASE_URL: z.url().startsWith('postgresql://') });

export const loadServiceConfig = (env: NodeJS.ProcessEnv) => serviceSchema.parse(env);
const workerSchema = baseSchema.extend({
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z.url().startsWith('redis://'),
  AI_PROVIDER: z.enum(['MOCK', 'DEEPSEEK']).default('MOCK'),
  AI_MOCK_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().startsWith('https://').default('https://api.deepseek.com'),
  AI_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
});
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => {
  const config = workerSchema.parse(env);
  if (config.AI_PROVIDER === 'MOCK' && !config.AI_MOCK_ENABLED)
    throw new Error('AI Mock Provider is disabled');
  if (config.AI_PROVIDER === 'DEEPSEEK' && !config.DEEPSEEK_API_KEY)
    throw new Error('DeepSeek API key is required');
  return config;
};
export const loadDatabaseConfig = (env: NodeJS.ProcessEnv) => databaseSchema.parse(env);
