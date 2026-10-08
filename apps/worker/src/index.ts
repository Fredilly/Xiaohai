import { loadWorkerConfig } from '@xiaohai/config';
import pino from 'pino';
import { createClient } from 'redis';
import { createDatabase } from '@xiaohai/db';
import { AiJobProcessor } from './ai-processor.js';
import {
  BailianAiProvider,
  DeepSeekAiProvider,
  MockAiProvider,
  QwenAiProvider,
} from './ai-provider.js';
import { BaselineModerationAdapter } from './moderation.js';
import { ImageJobProcessor } from './image-processor.js';
import { BailianImageProvider, MockImageProvider } from './image-provider.js';
import { createBaiduBosStorage } from './bos-storage.js';
import { VideoJobProcessor } from './video-processor.js';
import { MockVideoProvider } from './video-provider.js';
import { CompositionProcessor } from './composition-processor.js';
import { MockCompositionProvider } from './composition-provider.js';
import { recoverStaleMedia } from './stale-media.js';

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
    : config.AI_PROVIDER === 'QWEN'
      ? new QwenAiProvider(config.DASHSCOPE_API_KEY!, config.QWEN_BASE_URL)
      : config.AI_PROVIDER === 'BAILIAN'
        ? new BailianAiProvider(config.DASHSCOPE_API_KEY!, config.DASHSCOPE_BASE_URL!)
        : new MockAiProvider();
const moderation = new BaselineModerationAdapter(config.APP_ENV !== 'dev');
const processor = new AiJobProcessor(db, provider, moderation);
const imageProvider =
  config.PICTURE_BOOK_IMAGE_ENABLED && config.PICTURE_BOOK_IMAGE_PROVIDER === 'BAILIAN'
    ? new BailianImageProvider(
        config.DASHSCOPE_API_KEY!,
        (config.PICTURE_BOOK_IMAGE_BASE_URL ?? config.DASHSCOPE_BASE_URL)!,
        createBaiduBosStorage({
          endpoint: config.BAIDU_BOS_ENDPOINT!,
          bucket: config.BAIDU_BOS_BUCKET!,
          publicOrigin: config.BAIDU_BOS_PUBLIC_ORIGIN!,
          accessKeyId: config.BAIDU_BOS_ACCESS_KEY_ID!,
          secretAccessKey: config.BAIDU_BOS_SECRET_ACCESS_KEY!,
        }),
      )
    : new MockImageProvider();
const imageProcessor = config.PICTURE_BOOK_IMAGE_ENABLED
  ? new ImageJobProcessor(db, imageProvider, config.PICTURE_BOOK_IMAGE_TIMEOUT_MS, logger)
  : null;

const videoProvider = new MockVideoProvider();
const videoProcessor = config.ANIMATION_VIDEO_ENABLED
  ? new VideoJobProcessor(db, videoProvider, config.ANIMATION_VIDEO_TIMEOUT_MS, moderation)
  : null;
const compositionProvider = new MockCompositionProvider();
const compositionProcessor = config.ANIMATION_COMPOSITION_ENABLED
  ? new CompositionProcessor(db, compositionProvider, config.ANIMATION_COMPOSITION_TIMEOUT_MS)
  : null;
await processor.recoverStale();
const mediaTimeouts = {
  imageMs: config.PICTURE_BOOK_IMAGE_TIMEOUT_MS,
  videoMs: config.ANIMATION_VIDEO_TIMEOUT_MS,
  compositionMs: config.ANIMATION_COMPOSITION_TIMEOUT_MS,
};
let lastRecovery = 0;
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
while (!stopping) {
  try {
    if (Date.now() - lastRecovery > 60_000) {
      await processor.recoverStale();
      const recovered = await recoverStaleMedia(db, mediaTimeouts);
      logger.info({ event: 'WORKER_HEALTH', recovered }, 'Worker recovery sweep');
      lastRecovery = Date.now();
    }
    // Redis is the wake-up queue; PostgreSQL claim is authoritative and recovers lost notifications.
    const queues = ['xiaohai:ai:jobs'];
    if (imageProcessor) queues.push('xiaohai:image:jobs');
    if (videoProcessor) queues.push('xiaohai:animation:jobs');
    if (compositionProcessor) queues.push('xiaohai:animation:compositions');

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
    const compositionId = await compositionProcessor?.processOne();
    if (compositionId)
      logger.info(
        { compositionId, provider: compositionProvider.name },
        'Animation composition processed',
      );
  } catch (error) {
    // Log only bounded, non-sensitive error metadata; provider responses may contain secrets.
    const failure =
      error && typeof error === 'object'
        ? (error as { name?: unknown; code?: unknown })
        : {};
    logger.error(
      {
        errorCode: 'AI_WORKER_ITERATION_FAILED',
        exceptionName: typeof failure.name === 'string' ? failure.name.slice(0, 80) : undefined,
        exceptionCode: typeof failure.code === 'string' ? failure.code.slice(0, 80) : undefined,
      },
      'AI worker iteration failed',
    );
    // Avoid an unbounded error loop when Redis or the database is unavailable.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
await redis.quit();
await pool.end();
