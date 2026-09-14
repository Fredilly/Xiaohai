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
});
const databaseSchema = baseSchema.extend({ DATABASE_URL: z.url().startsWith('postgresql://') });

export const loadServiceConfig = (env: NodeJS.ProcessEnv) => serviceSchema.parse(env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => baseSchema.parse(env);
export const loadDatabaseConfig = (env: NodeJS.ProcessEnv) => databaseSchema.parse(env);
