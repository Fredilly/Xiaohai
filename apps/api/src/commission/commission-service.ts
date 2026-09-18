import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type {
  CreateCommissionRuleRequest,
  ReviewWithdrawalRequest,
} from '@xiaohai/contracts/commission';
import {
  commissionEvents,
  commissionLedger,
  commissionRules,
  orders,
  referralAttributions,
  referralLinks,
  withdrawalRequests,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const commissionPermissions = {
  read: 'commission.read',
  rulesManage: 'commission.rules.manage',
  settle: 'commission.settle',
  withdrawalsReview: 'commission.withdrawals.review',
} as const;

export class CommissionError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'INVALID_STATE' | 'CONFLICT' | 'INSUFFICIENT_BALANCE' | 'STALE_VERSION',
  ) {
    super(code);
  }
}

export class CommissionService {
  constructor(private readonly db: Db) {}

  async createReferralLink(consumerUserId: string, label?: string) {
    const [row] = await this.db
      .insert(referralLinks)
      .values({
        ownerConsumerUserId: consumerUserId,
        code: randomBytes(8).toString('hex').toUpperCase(),
        label,
      })
      .returning();
    return referralView(row!);
  }

  async listReferralLinks(consumerUserId: string) {
    const rows = await this.db
      .select()
      .from(referralLinks)
      .where(eq(referralLinks.ownerConsumerUserId, consumerUserId))
      .orderBy(desc(referralLinks.createdAt));
    return { links: rows.map(referralView) };
  }

  async attributeOrder(tx: Tx, orderId: string, referredConsumerUserId: string, code?: string) {
    if (!code) return;

    const [order] = await tx
      .select({
        consumerUserId: orders.consumerUserId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order || order.consumerUserId !== referredConsumerUserId || order.status !== 'UNPAID')
      return;

    const [link] = await tx
      .select()
      .from(referralLinks)
      .where(and(eq(referralLinks.code, code), eq(referralLinks.status, 'ACTIVE')))
      .limit(1);
    if (!link) return;
    if (link.ownerConsumerUserId === referredConsumerUserId) return;
    await tx
      .insert(referralAttributions)
      .values({
        orderId,
        referralLinkId: link.id,
        referredConsumerUserId,
        beneficiaryConsumerUserId: link.ownerConsumerUserId,
      })
      .onConflictDoNothing();
  }

  async freezeForPaidOrder(tx: Tx, orderId: string, eventKey: string, now = new Date()) {
    const [row] = await tx
      .select({ attribution: referralAttributions, order: orders })
      .from(referralAttributions)
      .innerJoin(orders, eq(orders.id, referralAttributions.orderId))
      .where(eq(referralAttributions.orderId, orderId))
      .limit(1);
    if (!row) return;
    const [rule] = await tx
      .select()
      .from(commissionRules)
      .where(
        and(
          eq(commissionRules.status, 'ACTIVE'),
          lte(commissionRules.effectiveFrom, now),
          or(isNull(commissionRules.effectiveTo), gt(commissionRules.effectiveTo, now)),
        ),
      )
      .orderBy(desc(commissionRules.effectiveFrom))
      .limit(1);
    if (!rule) return; // No approved policy means no financial entitlement.
    const amountMinor = Math.floor((row.order.totalMinor * rule.rateBasisPoints) / 10_000);
    if (amountMinor <= 0) return;
    const frozenUntil = new Date(now.getTime() + rule.freezeDays * 86_400_000);
    const [event] = await tx
      .insert(commissionEvents)
      .values({
        eventKey: `payment:${eventKey}`,
        type: 'FROZEN',
        beneficiaryConsumerUserId: row.attribution.beneficiaryConsumerUserId,
        attributionId: row.attribution.id,
        ruleId: rule.id,
        amountMinor,
        frozenUntil,
        metadata: { basisMinor: row.order.totalMinor, rateBasisPoints: rule.rateBasisPoints },
      })
      .onConflictDoNothing()
      .returning();
    if (event)
      await tx.insert(commissionLedger).values({
        eventId: event.id,
        beneficiaryConsumerUserId: event.beneficiaryConsumerUserId,
        frozenDeltaMinor: amountMinor,
      });
  }

  async reverseForRefund(
    tx: Tx,
    orderId: string,
    refundId: string,
    refundAmountMinor: number,
    paymentAmountMinor: number,
  ) {
    const [frozen] = await tx
      .select()
      .from(commissionEvents)
      .innerJoin(referralAttributions, eq(referralAttributions.id, commissionEvents.attributionId))
      .where(and(eq(referralAttributions.orderId, orderId), eq(commissionEvents.type, 'FROZEN')))
      .for('update')
      .limit(1);
    if (!frozen) return;
    const amountMinor = Math.min(
      frozen.commission_events.amountMinor,
      Math.floor((frozen.commission_events.amountMinor * refundAmountMinor) / paymentAmountMinor),
    );
    if (amountMinor <= 0) return;

    await lockConsumer(tx, frozen.commission_events.beneficiaryConsumerUserId);

    const [settled] = await tx
      .select({ id: commissionEvents.id })
      .from(commissionEvents)
      .where(
        and(
          eq(commissionEvents.parentEventId, frozen.commission_events.id),
          eq(commissionEvents.type, 'SETTLED'),
        ),
      )
      .limit(1);
    const [event] = await tx
      .insert(commissionEvents)
      .values({
        eventKey: `refund:${refundId}`,
        type: 'REVERSED',
        beneficiaryConsumerUserId: frozen.commission_events.beneficiaryConsumerUserId,
        attributionId: frozen.commission_events.attributionId,
        ruleId: frozen.commission_events.ruleId,
        refundId,
        parentEventId: frozen.commission_events.id,
        amountMinor,
        metadata: { refundAmountMinor, paymentAmountMinor },
      })
      .onConflictDoNothing()
      .returning();
    if (event)
      await tx.insert(commissionLedger).values({
        eventId: event.id,
        beneficiaryConsumerUserId: event.beneficiaryConsumerUserId,
        frozenDeltaMinor: settled ? 0 : -amountMinor,
        availableDeltaMinor: settled ? -amountMinor : 0,
      });
  }

  async getAccount(consumerUserId: string) {
    const [balance] = await this.db
      .select({
        frozen: sql<number>`coalesce(sum(${commissionLedger.frozenDeltaMinor}), 0)::int`,
        available: sql<number>`coalesce(sum(${commissionLedger.availableDeltaMinor}), 0)::int`,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryConsumerUserId, consumerUserId));
    const entries = await this.db
      .select({
        id: commissionLedger.id,
        eventType: commissionEvents.type,
        amountMinor: commissionEvents.amountMinor,
        frozenDeltaMinor: commissionLedger.frozenDeltaMinor,
        availableDeltaMinor: commissionLedger.availableDeltaMinor,
        createdAt: commissionLedger.createdAt,
      })
      .from(commissionLedger)
      .innerJoin(commissionEvents, eq(commissionEvents.id, commissionLedger.eventId))
      .where(eq(commissionLedger.beneficiaryConsumerUserId, consumerUserId))
      .orderBy(desc(commissionLedger.createdAt));
    return {
      frozenMinor: balance?.frozen ?? 0,
      availableMinor: balance?.available ?? 0,
      entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  }

  async createWithdrawal(consumerUserId: string, amountMinor: number, clientRequestId: string) {
    return this.db.transaction(async (tx) => {
      await lockConsumer(tx, consumerUserId);
      const [existing] = await tx
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.consumerUserId, consumerUserId),
            eq(withdrawalRequests.clientRequestId, clientRequestId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.amountMinor !== amountMinor) throw new CommissionError('CONFLICT');
        return withdrawalView(existing);
      }
      const [balance] = await tx
        .select({
          available: sql<number>`coalesce(sum(${commissionLedger.availableDeltaMinor}), 0)::int`,
        })
        .from(commissionLedger)
        .where(eq(commissionLedger.beneficiaryConsumerUserId, consumerUserId));
      if ((balance?.available ?? 0) < amountMinor)
        throw new CommissionError('INSUFFICIENT_BALANCE');
      const [request] = await tx
        .insert(withdrawalRequests)
        .values({ consumerUserId, amountMinor, clientRequestId })
        .returning();
      await appendWithdrawalMovement(
        tx,
        request!.id,
        consumerUserId,
        'WITHDRAWAL_HELD',
        `withdrawal:${request!.id}:held`,
        amountMinor,
        -amountMinor,
      );
      return withdrawalView(request!);
    });
  }

  async listWithdrawals(consumerUserId: string) {
    const rows = await this.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.consumerUserId, consumerUserId))
      .orderBy(desc(withdrawalRequests.createdAt));
    return { withdrawals: rows.map(withdrawalView) };
  }

  async cancelWithdrawal(consumerUserId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lockConsumer(tx, consumerUserId);
      const [row] = await tx
        .select()
        .from(withdrawalRequests)
        .where(
          and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.consumerUserId, consumerUserId)),
        )
        .for('update')
        .limit(1);
      if (!row) throw new CommissionError('NOT_FOUND');
      if (row.status === 'CANCELLED') return withdrawalView(row);
      if (row.status !== 'REQUESTED') throw new CommissionError('INVALID_STATE');
      const [updated] = await tx
        .update(withdrawalRequests)
        .set({ status: 'CANCELLED', version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.version, row.version)))
        .returning();
      await appendWithdrawalMovement(
        tx,
        id,
        consumerUserId,
        'WITHDRAWAL_RELEASED',
        `withdrawal:${id}:released`,
        row.amountMinor,
        row.amountMinor,
      );
      return withdrawalView(updated!);
    });
  }

  async createRule(staffId: string, input: CreateCommissionRuleRequest) {
    if (input.effectiveTo && new Date(input.effectiveTo) <= new Date(input.effectiveFrom))
      throw new CommissionError('CONFLICT');
    const [row] = await this.db
      .insert(commissionRules)
      .values({
        ...input,
        effectiveFrom: new Date(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        createdByStaffAccountId: staffId,
      })
      .returning();
    return ruleView(row!);
  }

  async setRuleStatus(id: string, status: 'ACTIVE' | 'INACTIVE', version: number) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commission-rule-activation'))`);
      const [row] = await tx
        .select()
        .from(commissionRules)
        .where(eq(commissionRules.id, id))
        .for('update')
        .limit(1);
      if (!row) throw new CommissionError('NOT_FOUND');
      if (row.version !== version) throw new CommissionError('STALE_VERSION');
      if (status === 'ACTIVE') {
        const overlap = await tx
          .select({ id: commissionRules.id })
          .from(commissionRules)
          .where(
            and(
              eq(commissionRules.status, 'ACTIVE'),
              sql`${commissionRules.id} <> ${id}`,
              or(
                isNull(commissionRules.effectiveTo),
                gt(commissionRules.effectiveTo, row.effectiveFrom),
              ),
              row.effectiveTo ? lt(commissionRules.effectiveFrom, row.effectiveTo) : undefined,
            ),
          )
          .limit(1);
        if (overlap.length) throw new CommissionError('CONFLICT');
      }
      const [updated] = await tx
        .update(commissionRules)
        .set({ status, version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(commissionRules.id, id), eq(commissionRules.version, version)))
        .returning();
      return ruleView(updated!);
    });
  }

  async settle(eventId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(commissionEvents)
        .where(eq(commissionEvents.id, eventId))
        .for('update')
        .limit(1);
      if (!row) throw new CommissionError('NOT_FOUND');
      if (row.type !== 'FROZEN' || !row.frozenUntil || row.frozenUntil > new Date())
        throw new CommissionError('INVALID_STATE');
      const reversed = await tx
        .select({ id: commissionEvents.id })
        .from(commissionEvents)
        .where(
          and(eq(commissionEvents.parentEventId, eventId), eq(commissionEvents.type, 'REVERSED')),
        )
        .limit(1);
      if (reversed.length) throw new CommissionError('INVALID_STATE');
      const [event] = await tx
        .insert(commissionEvents)
        .values({
          eventKey: `settle:${eventId}`,
          type: 'SETTLED',
          beneficiaryConsumerUserId: row.beneficiaryConsumerUserId,
          attributionId: row.attributionId,
          ruleId: row.ruleId,
          parentEventId: row.id,
          amountMinor: row.amountMinor,
        })
        .onConflictDoNothing()
        .returning();
      if (event)
        await tx.insert(commissionLedger).values({
          eventId: event.id,
          beneficiaryConsumerUserId: event.beneficiaryConsumerUserId,
          frozenDeltaMinor: -event.amountMinor,
          availableDeltaMinor: event.amountMinor,
        });
      return { settled: true };
    });
  }

  async staffOverview() {
    const [rules, withdrawals, frozenRows, childRows] = await Promise.all([
      this.db.select().from(commissionRules).orderBy(desc(commissionRules.createdAt)),
      this.db.select().from(withdrawalRequests).orderBy(desc(withdrawalRequests.createdAt)),
      this.db
        .select()
        .from(commissionEvents)
        .where(eq(commissionEvents.type, 'FROZEN'))
        .orderBy(desc(commissionEvents.createdAt)),
      this.db
        .select({ parentEventId: commissionEvents.parentEventId, type: commissionEvents.type })
        .from(commissionEvents)
        .where(sql`${commissionEvents.type} in ('SETTLED','REVERSED')`),
    ]);
    const children = new Map<string | null, string>();
    for (const row of childRows) {
      if (row.type === 'REVERSED' || !children.has(row.parentEventId))
        children.set(row.parentEventId, row.type);
    }
    return {
      rules: rules.map(ruleView),
      earnings: frozenRows.map((row) => ({
        id: row.id,
        beneficiaryConsumerUserId: row.beneficiaryConsumerUserId,
        amountMinor: row.amountMinor,
        frozenUntil: row.frozenUntil!.toISOString(),
        state: children.get(row.id) ?? 'FROZEN',
        createdAt: row.createdAt.toISOString(),
      })),
      withdrawals: withdrawals.map((w) => ({
        ...withdrawalView(w),
        consumerUserId: w.consumerUserId,
      })),
    };
  }

  async reviewWithdrawal(id: string, staffId: string, input: ReviewWithdrawalRequest) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.id, id))
        .for('update')
        .limit(1);
      if (!row) throw new CommissionError('NOT_FOUND');
      if (row.version !== input.version) throw new CommissionError('STALE_VERSION');
      const allowed =
        input.action === 'APPROVE'
          ? row.status === 'REQUESTED'
          : input.action === 'REJECT'
            ? ['REQUESTED', 'APPROVED'].includes(row.status)
            : row.status === 'APPROVED';
      if (!allowed) throw new CommissionError('INVALID_STATE');

      await lockConsumer(tx, row.consumerUserId);

      if (input.action === 'MARK_PAID') {
        const [balance] = await tx
          .select({
            available: sql<number>`coalesce(sum(${commissionLedger.availableDeltaMinor}), 0)::int`,
          })
          .from(commissionLedger)
          .where(eq(commissionLedger.beneficiaryConsumerUserId, row.consumerUserId));

        if ((balance?.available ?? 0) < 0) {
          const [rejected] = await tx
            .update(withdrawalRequests)
            .set({
              status: 'REJECTED',
              reviewedByStaffAccountId: staffId,
              reviewNote:
                input.note ??
                'Payout blocked because commission balance became negative before payout',
              version: row.version + 1,
              updatedAt: new Date(),
              paidAt: null,
            })
            .where(
              and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.version, input.version)),
            )
            .returning();

          if (!rejected) throw new CommissionError('STALE_VERSION');

          await appendWithdrawalMovement(
            tx,
            id,
            row.consumerUserId,
            'WITHDRAWAL_RELEASED',
            `withdrawal:${id}:rejected`,
            row.amountMinor,
            row.amountMinor,
          );

          return withdrawalView(rejected);
        }
      }

      const status =
        input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'PAID';
      const [updated] = await tx
        .update(withdrawalRequests)
        .set({
          status,
          reviewedByStaffAccountId: staffId,
          reviewNote: input.note,
          version: row.version + 1,
          updatedAt: new Date(),
          paidAt: status === 'PAID' ? new Date() : null,
        })
        .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.version, input.version)))
        .returning();
      if (input.action === 'REJECT')
        await appendWithdrawalMovement(
          tx,
          id,
          row.consumerUserId,
          'WITHDRAWAL_RELEASED',
          `withdrawal:${id}:rejected`,
          row.amountMinor,
          row.amountMinor,
        );
      else
        await tx
          .insert(commissionEvents)
          .values({
            eventKey: `withdrawal:${id}:${status.toLowerCase()}`,
            type: input.action === 'APPROVE' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_PAID',
            beneficiaryConsumerUserId: row.consumerUserId,
            withdrawalRequestId: id,
            amountMinor: row.amountMinor,
          })
          .onConflictDoNothing();
      return withdrawalView(updated!);
    });
  }
}

async function lockConsumer(tx: Tx, id: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
}
async function appendWithdrawalMovement(
  tx: Tx,
  withdrawalRequestId: string,
  consumerUserId: string,
  type: 'WITHDRAWAL_HELD' | 'WITHDRAWAL_RELEASED',
  eventKey: string,
  amountMinor: number,
  availableDeltaMinor: number,
) {
  const [event] = await tx
    .insert(commissionEvents)
    .values({
      eventKey,
      type,
      beneficiaryConsumerUserId: consumerUserId,
      withdrawalRequestId,
      amountMinor,
    })
    .onConflictDoNothing()
    .returning();
  if (event)
    await tx.insert(commissionLedger).values({
      eventId: event.id,
      beneficiaryConsumerUserId: consumerUserId,
      availableDeltaMinor,
    });
}
function referralView(r: typeof referralLinks.$inferSelect) {
  return {
    id: r.id,
    code: r.code,
    label: r.label,
    status: r.status,
    sharePath: `/pages/referral/referral?code=${encodeURIComponent(r.code)}`,
    createdAt: r.createdAt.toISOString(),
  };
}
function ruleView(r: typeof commissionRules.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    basis: r.basis,
    rateBasisPoints: r.rateBasisPoints,
    freezeDays: r.freezeDays,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  };
}
function withdrawalView(r: typeof withdrawalRequests.$inferSelect) {
  return {
    id: r.id,
    amountMinor: r.amountMinor,
    status: r.status,
    clientRequestId: r.clientRequestId,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  };
}
