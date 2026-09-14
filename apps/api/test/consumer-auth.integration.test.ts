import { count, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, consumerUsers, wechatIdentities } from '@xiaohai/db';
import { ConsumerAuthService } from '../src/auth/consumer-auth-service.js';
import { DrizzleConsumerIdentityRepository } from '../src/auth/consumer-repository.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import type { WeChatAuthProvider } from '../src/auth/wechat-provider.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;

testSuite('consumer auth PostgreSQL integration', () => {
  beforeEach(async () => {
    await database!.db.delete(wechatIdentities);
    await database!.db.delete(consumerUsers);
  });
  afterAll(async () => database?.pool.end());

  it('enforces app_id + openid uniqueness', async () => {
    const [consumer] = await database!.db
      .insert(consumerUsers)
      .values({})
      .returning({ id: consumerUsers.id });
    await database!.db.insert(wechatIdentities).values({
      consumerUserId: consumer!.id,
      appId: 'app-a',
      openid: 'openid-a',
    });
    await expect(
      database!.db.insert(wechatIdentities).values({
        consumerUserId: consumer!.id,
        appId: 'app-a',
        openid: 'openid-a',
      }),
    ).rejects.toThrow();
  });

  it('creates on first login and returns the same identity on repeat login', async () => {
    const provider: WeChatAuthProvider = {
      codeToSession: vi.fn().mockResolvedValue({ openid: 'openid-repeatable' }),
    };
    const service = new ConsumerAuthService(
      'app-a',
      provider,
      new DrizzleConsumerIdentityRepository(database!.db),
      new ConsumerSessionService('integration-session-secret-at-least-32-characters', 300),
    );
    const first = await service.login('first-code');
    const second = await service.login('second-code');

    expect(second.consumer.id).toBe(first.consumer.id);
    const [users] = await database!.db.select({ value: count() }).from(consumerUsers);
    const [identities] = await database!.db
      .select({ value: count() })
      .from(wechatIdentities)
      .where(eq(wechatIdentities.openid, 'openid-repeatable'));
    expect(users!.value).toBe(1);
    expect(identities!.value).toBe(1);
  });
});
