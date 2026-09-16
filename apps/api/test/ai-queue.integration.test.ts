import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { RedisAiQueue } from '../src/ai/ai-queue.js';

const redisUrl = process.env.REDIS_URL;
const suite = redisUrl ? describe : describe.skip;

suite('M8 Redis queue integration', () => {
  const queue = new RedisAiQueue(redisUrl!);
  const consumer = createClient({ url: redisUrl });

  afterAll(async () => {
    await queue.close();
    if (consumer.isOpen) await consumer.quit();
  });

  it('publishes only the opaque job identifier to the Redis wake-up queue', async () => {
    await consumer.connect();
    await consumer.del('xiaohai:ai:jobs');
    await queue.notify('00000000-0000-4000-8000-000000000008');
    const item = await consumer.brPop('xiaohai:ai:jobs', 1);
    expect(item?.element).toBe('00000000-0000-4000-8000-000000000008');
  });
});
