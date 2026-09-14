import { loadServiceConfig } from '@xiaohai/config';
import { buildApp } from './app.js';

const config = loadServiceConfig(process.env);
const app = buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
