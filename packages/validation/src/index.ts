import { z } from 'zod';

export const appEnvironmentSchema = z.enum(['dev', 'staging', 'production']);
export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
