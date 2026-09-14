import { and, count, eq, isNull } from 'drizzle-orm';
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

  it('recovers one identity without an orphan when identical first logins race', async () => {
    const advisoryLockKey = 724_501;
    await database!.pool.query(`
      CREATE OR REPLACE FUNCTION test_consumer_insert_barrier()
      RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${advisoryLockKey});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_consumer_insert_barrier
      BEFORE INSERT ON consumer_users
      FOR EACH ROW EXECUTE FUNCTION test_consumer_insert_barrier();
    `);

    const lockClient = await database!.pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [advisoryLockKey]);

    let providerCalls = 0;
    let openProviderGate: () => void = () => {};
    const providerGate = new Promise<void>((resolve) => {
      openProviderGate = resolve;
    });
    const provider: WeChatAuthProvider = {
      codeToSession: vi.fn(async () => {
        providerCalls += 1;
        if (providerCalls === 2) openProviderGate();
        await providerGate;
        return { openid: 'openid-concurrent' };
      }),
    };
    const service = new ConsumerAuthService(
      'app-concurrent',
      provider,
      new DrizzleConsumerIdentityRepository(database!.db),
      new ConsumerSessionService('integration-session-secret-at-least-32-characters', 300),
    );

    const logins = Promise.all([service.login('code-a'), service.login('code-b')]);
    try {
      await waitForAdvisoryWaiters(async () => {
        const result = await lockClient.query<{ waiters: number }>(
          `SELECT count(*)::int AS waiters
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND objid = $1
             AND NOT granted`,
          [advisoryLockKey],
        );
        return result.rows[0]?.waiters ?? 0;
      }, 2);
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
      lockClient.release();
    }

    const [first, second] = await logins;
    expect(second.consumer.id).toBe(first.consumer.id);

    const [users] = await database!.db.select({ value: count() }).from(consumerUsers);
    const [identities] = await database!.db
      .select({ value: count() })
      .from(wechatIdentities)
      .where(
        and(
          eq(wechatIdentities.appId, 'app-concurrent'),
          eq(wechatIdentities.openid, 'openid-concurrent'),
        ),
      );
    const [orphans] = await database!.db
      .select({ value: count() })
      .from(consumerUsers)
      .leftJoin(wechatIdentities, eq(consumerUsers.id, wechatIdentities.consumerUserId))
      .where(isNull(wechatIdentities.id));

    expect(users!.value).toBe(1);
    expect(identities!.value).toBe(1);
    expect(orphans!.value).toBe(0);

    await database!.pool.query(`
      DROP TRIGGER test_consumer_insert_barrier ON consumer_users;
      DROP FUNCTION test_consumer_insert_barrier();
    `);
  });
});

async function waitForAdvisoryWaiters(
  countWaiters: () => Promise<number>,
  expectedWaiters: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await countWaiters()) === expectedWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expectedWaiters} concurrent PostgreSQL contenders`);
}
