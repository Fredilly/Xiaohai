import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { RedisCompositionQueue } from '../src/animation/composition-queue.js';
import { RedisVideoQueue } from '../src/animation/video-queue.js';

const redisUrl = process.env.REDIS_URL;
const suite = redisUrl ? describe : describe.skip;

suite('M11 Redis wake-up queue integration', () => {
  const video = new RedisVideoQueue(redisUrl!);
  const composition = new RedisCompositionQueue(redisUrl!);
  const consumer = createClient({ url: redisUrl });

  afterAll(async () => {
    await video.close();
    await composition.close();
    if (consumer.isOpen) await consumer.quit();
  });

  it('publishes opaque scene and composition identifiers to separate queues', async () => {
    await consumer.connect();
    await consumer.del(['xiaohai:animation:jobs', 'xiaohai:animation:compositions']);
    await video.notify('00000000-0000-4000-8000-000000000011');
    await composition.notify('00000000-0000-4000-8000-000000000012');
    const scene = await consumer.brPop('xiaohai:animation:jobs', 1);
    const final = await consumer.brPop('xiaohai:animation:compositions', 1);
    expect(scene?.element).toBe('00000000-0000-4000-8000-000000000011');
    expect(final?.element).toBe('00000000-0000-4000-8000-000000000012');
  });
});
