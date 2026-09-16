import { loadWorkerConfig } from '@xiaohai/config';
import pino from 'pino';
import { createClient } from 'redis';
import { createDatabase } from '@xiaohai/db';
import { AiJobProcessor } from './ai-processor.js';
import { DeepSeekAiProvider, MockAiProvider } from './ai-provider.js';
import { BaselineModerationAdapter } from './moderation.js';

const config = loadWorkerConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });

logger.info({ appEnv: config.APP_ENV, service: 'worker' }, 'Worker foundation ready');
const { db, pool } = createDatabase(process.env);
const redis = createClient({ url: config.REDIS_URL });
redis.on('error', () => logger.error({ errorCode: 'REDIS_UNAVAILABLE' }, 'AI queue Redis error'));
await redis.connect();
const provider =
  config.AI_PROVIDER === 'DEEPSEEK'
    ? new DeepSeekAiProvider(config.DEEPSEEK_API_KEY!, config.DEEPSEEK_BASE_URL)
    : new MockAiProvider();
const processor = new AiJobProcessor(db, provider, new BaselineModerationAdapter());
await processor.recoverStale();
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
while (!stopping) {
  try {
    // Redis is the wake-up queue; PostgreSQL claim is authoritative and recovers lost notifications.
    await redis.brPop('xiaohai:ai:jobs', config.AI_WORKER_POLL_MS / 1000);
    const jobId = await processor.processOne();
    if (jobId) logger.info({ jobId, provider: provider.name }, 'AI job processed');
  } catch {
    logger.error({ errorCode: 'AI_WORKER_ITERATION_FAILED' }, 'AI worker iteration failed');
  }
}
await redis.quit();
await pool.end();
