import { and, eq } from 'drizzle-orm';
import { consumerUsers, wechatIdentities, type createDatabase } from '@xiaohai/db';
import type { ConsumerIdentity } from '@xiaohai/domain';

type Database = ReturnType<typeof createDatabase>['db'];

export interface ConsumerIdentityRepository {
  findOrCreateWechatIdentity(input: {
    appId: string;
    openid: string;
    unionid?: string;
  }): Promise<ConsumerIdentity>;
}

export class DrizzleConsumerIdentityRepository implements ConsumerIdentityRepository {
  constructor(private readonly db: Database) {}

  async findOrCreateWechatIdentity(input: {
    appId: string;
    openid: string;
    unionid?: string;
  }): Promise<ConsumerIdentity> {
    const existing = await this.find(input.appId, input.openid);
    if (existing) {
      await this.db
        .update(wechatIdentities)
        .set({ lastLoginAt: new Date(), ...(input.unionid ? { unionid: input.unionid } : {}) })
        .where(eq(wechatIdentities.id, existing.wechatIdentityId));
      return existing;
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [consumer] = await tx
          .insert(consumerUsers)
          .values({})
          .returning({ id: consumerUsers.id });
        if (!consumer) throw new Error('consumer insert returned no row');
        const [identity] = await tx
          .insert(wechatIdentities)
          .values({
            consumerUserId: consumer.id,
            appId: input.appId,
            openid: input.openid,
            unionid: input.unionid,
          })
          .onConflictDoNothing({ target: [wechatIdentities.appId, wechatIdentities.openid] })
          .returning({ id: wechatIdentities.id });
        if (!identity) throw new IdentityConflictError();
        return { consumerUserId: consumer.id, wechatIdentityId: identity.id };
      });
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        const winner = await this.find(input.appId, input.openid);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async find(appId: string, openid: string): Promise<ConsumerIdentity | null> {
    const [identity] = await this.db
      .select({
        consumerUserId: wechatIdentities.consumerUserId,
        wechatIdentityId: wechatIdentities.id,
      })
      .from(wechatIdentities)
      .where(and(eq(wechatIdentities.appId, appId), eq(wechatIdentities.openid, openid)))
      .limit(1);
    return identity ?? null;
  }
}

class IdentityConflictError extends Error {}
