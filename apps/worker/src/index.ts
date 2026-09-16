import { loadWorkerConfig } from '@xiaohai/config';
import pino from 'pino';
import { createClient } from 'redis';
import { createDatabase } from '@xiaohai/db';
import { AiJobProcessor } from './ai-processor.js';
import { DeepSeekAiProvider, MockAiProvider } from './ai-provider.js';
import { BaselineModerationAdapter } from './moderation.js';
import { ImageJobProcessor } from './image-processor.js';
import { MockImageProvider } from './image-provider.js';
import { VideoJobProcessor } from './video-processor.js';
import { MockVideoProvider } from './video-provider.js';

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
const imageProvider = new MockImageProvider();
const imageProcessor = config.PICTURE_BOOK_IMAGE_ENABLED
  ? new ImageJobProcessor(db, imageProvider, config.PICTURE_BOOK_IMAGE_TIMEOUT_MS)
  : null;

const videoProvider = new MockVideoProvider();
const videoProcessor = config.ANIMATION_VIDEO_ENABLED
  ? new VideoJobProcessor(db, videoProvider, config.ANIMATION_VIDEO_TIMEOUT_MS)
  : null;
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
    const queues = ['xiaohai:ai:jobs'];
    if (imageProcessor) queues.push('xiaohai:image:jobs');
    if (videoProcessor) queues.push('xiaohai:animation:jobs');

    await redis.brPop(queues, config.AI_WORKER_POLL_MS / 1000);
    const jobId = await processor.processOne();
    if (jobId) logger.info({ jobId, provider: provider.name }, 'AI job processed');
    const illustrationId = await imageProcessor?.processOne();
    if (illustrationId) {
      logger.info({ illustrationId, provider: imageProvider.name }, 'Image job processed');
    }

    const generationId = await videoProcessor?.processOne();
    if (generationId) {
      logger.info({ generationId, provider: videoProvider.name }, 'Animation video job processed');
    }
  } catch {
    logger.error({ errorCode: 'AI_WORKER_ITERATION_FAILED' }, 'AI worker iteration failed');
  }
}
await redis.quit();
await pool.end();
