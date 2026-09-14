import { appEnvironmentSchema, logLevelSchema } from '@xiaohai/validation';
import { z } from 'zod';

const baseSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('dev'),
  LOG_LEVEL: logLevelSchema.default('info'),
});
const serviceSchema = baseSchema.extend({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});
const databaseSchema = baseSchema.extend({ DATABASE_URL: z.url().startsWith('postgresql://') });

export const loadServiceConfig = (env: NodeJS.ProcessEnv) => serviceSchema.parse(env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv) => baseSchema.parse(env);
export const loadDatabaseConfig = (env: NodeJS.ProcessEnv) => databaseSchema.parse(env);
