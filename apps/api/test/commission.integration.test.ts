import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  commissionEvents,
  commissionLedger,
  commissionRules,
  consumerUsers,
  createDatabase,
  financeLedgerEntries,
  orders,
  payments,
  permissions,
  refunds,
  referralAttributions,
  referralLinks,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  withdrawalRequests,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { CommissionService, commissionPermissions } from '../src/commission/commission-service.js';
import { registerCommissionRoutes } from '../src/commission/commission-routes.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M18 referral and commission PostgreSQL integration', () => {
  const db = database!.db;
  const service = new CommissionService(db);
  const sessions = new ConsumerSessionService(
    'm18-consumer-session-secret-at-least-32-characters',
    300,
  );
  const staffSessions = new StaffSessionService(
    'm18-staff-session-secret-at-least-32-characters',
    300,
  );
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(db),
    staffSessions,
  );
  const consumers: string[] = [],
    staff: string[] = [],
    testRoles: string[] = [];

  async function cleanup() {
    await db.delete(financeLedgerEntries);
    await db.delete(commissionLedger);
    await db.delete(commissionEvents);
    await db.delete(withdrawalRequests);
    await db.delete(refunds);
    await db.delete(payments);
    await db.delete(referralAttributions);
    await db.delete(referralLinks);
    await db.delete(commissionRules);
    for (const id of testRoles) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await db.delete(staffRoles).where(eq(staffRoles.roleId, id));
    }
    for (const id of staff)
      await db.delete(staffDataScopes).where(eq(staffDataScopes.staffAccountId, id));
    for (const id of testRoles.splice(0)) await db.delete(roles).where(eq(roles.id, id));
    for (const id of consumers.splice(0)) {
      await db.delete(orders).where(eq(orders.consumerUserId, id));
      await db.delete(consumerUsers).where(eq(consumerUsers.id, id));
    }
    for (const id of staff.splice(0))
      await db.delete(staffAccounts).where(eq(staffAccounts.id, id));
  }
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await database!.pool.end();
  });
  async function user() {
    const [row] = await db.insert(consumerUsers).values({}).returning();
    consumers.push(row!.id);
    return row!;
  }
  async function operator() {
    const [row] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'test-only' })
      .returning();
    staff.push(row!.id);
    return row!;
  }
  async function staffToken(permission: string, global: boolean) {
    const account = await operator();
    let [permissionRow] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, permission));
    if (!permissionRow)
      [permissionRow] = await db
        .insert(permissions)
        .values({ key: permission, displayName: permission })
        .returning();
    const [role] = await db
      .insert(roles)
      .values({ key: `m18-${randomUUID()}`, displayName: 'M18 test' })
      .returning();
    testRoles.push(role!.id);
    await db.insert(staffRoles).values({ staffAccountId: account.id, roleId: role!.id });
    await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permissionRow!.id });
    await db.insert(staffDataScopes).values({
      staffAccountId: account.id,
      scopeType: global ? 'GLOBAL' : 'REGION',
      scopeId: global ? null : randomUUID(),
    });
    return staffSessions.issue(account.id).token;
  }
  async function paidAttribution(freezeDays = 0) {
    const beneficiary = await user(),
      referred = await user(),
      admin = await operator();
    const link = await service.createReferralLink(beneficiary.id, 'test');
    const [order] = await db
      .insert(orders)
      .values({
        consumerUserId: referred.id,
        orderNumber: randomUUID(),
        subtotalMinor: 10000,
        totalMinor: 10000,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
        status: 'UNPAID',
      })
      .returning();

    await db.transaction((tx) => service.attributeOrder(tx, order!.id, referred.id, link.code));

    await db
      .update(orders)
      .set({ status: 'PAID', updatedAt: new Date() })
      .where(eq(orders.id, order!.id));

    const rule = await service.createRule(admin.id, {
      name: 'Explicit test policy',
      rateBasisPoints: 600,
      freezeDays,
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
    });
    await service.setRuleStatus(rule.id, 'ACTIVE', rule.version);
    await db.transaction((tx) => service.freezeForPaidOrder(tx, order!.id, order!.id));
    return { beneficiary, referred, order: order!, rule };
  }

  it('requires a consumer session and rejects server-controlled request fields', async () => {
    const app = buildApp({ logger: false });
    registerCommissionRoutes(app, {
      commission: service,
      consumerSessions: sessions,
      staffAuthorization: { authenticate: () => Promise.reject(new Error()) } as never,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/commissions/account' })).statusCode,
    ).toBe(401);
    const owner = await user();
    const token = sessions.issue(owner.id).token;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/commissions/withdrawals',
          headers: { authorization: `Bearer ${token}` },
          payload: { amountMinor: 1, clientRequestId: 'request-123', status: 'PAID' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('requires commission permission and GLOBAL data scope for HQ accounting', async () => {
    const app = buildApp({ logger: false });
    registerCommissionRoutes(app, {
      commission: service,
      consumerSessions: sessions,
      staffAuthorization: authorization,
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff/commissions' })).statusCode).toBe(
      401,
    );
    const wrongPermission = await staffToken('commission.unrelated', true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/commissions',
          headers: { authorization: `Bearer ${wrongPermission}` },
        })
      ).statusCode,
    ).toBe(403);
    const region = await staffToken(commissionPermissions.read, false);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/commissions',
          headers: { authorization: `Bearer ${region}` },
        })
      ).statusCode,
    ).toBe(403);
    const global = await staffToken(commissionPermissions.read, true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/commissions',
          headers: { authorization: `Bearer ${global}` },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('attributes one order, ignores self-referral, and keeps attribution server-owned', async () => {
    const owner = await user(),
      buyer = await user();
    const link = await service.createReferralLink(owner.id);
    const [order] = await db
      .insert(orders)
      .values({
        consumerUserId: buyer.id,
        orderNumber: randomUUID(),
        subtotalMinor: 100,
        totalMinor: 100,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
      })
      .returning();
    await db.transaction((tx) => service.attributeOrder(tx, order!.id, buyer.id, link.code));
    await db.transaction((tx) => service.attributeOrder(tx, order!.id, buyer.id, link.code));
    expect(await db.select().from(referralAttributions)).toHaveLength(1);
    const [ownOrder] = await db
      .insert(orders)
      .values({
        consumerUserId: owner.id,
        orderNumber: randomUUID(),
        subtotalMinor: 100,
        totalMinor: 100,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
      })
      .returning();
    await db.transaction((tx) => service.attributeOrder(tx, ownOrder!.id, owner.id, link.code));

    expect(await db.select().from(referralAttributions)).toHaveLength(1);

    const ownAttribution = await db
      .select()
      .from(referralAttributions)
      .where(eq(referralAttributions.orderId, ownOrder!.id));

    expect(ownAttribution).toHaveLength(0);
  });

  it('does not attribute an order after its state has changed', async () => {
    const owner = await user();
    const buyer = await user();
    const link = await service.createReferralLink(owner.id, 'state-check');

    const [order] = await db
      .insert(orders)
      .values({
        consumerUserId: buyer.id,
        orderNumber: randomUUID(),
        subtotalMinor: 1000,
        totalMinor: 1000,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
      })
      .returning();

    await db
      .update(orders)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(orders.id, order!.id));

    await db.transaction((tx) => service.attributeOrder(tx, order!.id, buyer.id, link.code));

    const attribution = await db
      .select()
      .from(referralAttributions)
      .where(eq(referralAttributions.orderId, order!.id));

    expect(attribution).toHaveLength(0);
  });

  it('derives balances from append-only ledger and duplicate events do not mutate history', async () => {
    const fixture = await paidAttribution();

    const snapshot = (rows: Array<typeof commissionLedger.$inferSelect>) =>
      rows
        .map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    const originalLedger = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryConsumerUserId, fixture.beneficiary.id));

    expect(originalLedger).toHaveLength(1);

    const originalSnapshot = snapshot(originalLedger);

    // Duplicate freeze event key must not create or mutate accounting history.
    await db.transaction((tx) =>
      service.freezeForPaidOrder(tx, fixture.order.id, fixture.order.id),
    );

    const afterDuplicateFreeze = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryConsumerUserId, fixture.beneficiary.id));

    expect(snapshot(afterDuplicateFreeze)).toEqual(originalSnapshot);

    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));

    await service.settle(frozen!.id);

    const afterSettle = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryConsumerUserId, fixture.beneficiary.id));

    expect(afterSettle).toHaveLength(2);

    // The original frozen ledger entry remains byte-for-byte unchanged.
    expect(snapshot(afterSettle.filter((row) => row.id === originalLedger[0]!.id))).toEqual(
      originalSnapshot,
    );

    const frozenTotal = afterSettle.reduce((sum, row) => sum + row.frozenDeltaMinor, 0);
    const availableTotal = afterSettle.reduce((sum, row) => sum + row.availableDeltaMinor, 0);

    expect(await service.getAccount(fixture.beneficiary.id)).toMatchObject({
      frozenMinor: frozenTotal,
      availableMinor: availableTotal,
    });

    const settledSnapshot = snapshot(afterSettle);

    // Duplicate settlement is idempotent: no extra ledger row and no mutation.
    await service.settle(frozen!.id);

    const afterDuplicateSettle = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryConsumerUserId, fixture.beneficiary.id));

    expect(snapshot(afterDuplicateSettle)).toEqual(settledSnapshot);

    const financeEntries = await db.select().from(financeLedgerEntries);
    expect(financeEntries).toHaveLength(2);
    expect(
      financeEntries
        .map((entry) => ({
          eventType: entry.eventType,
          frozen: entry.commissionFrozenDeltaMinor,
          available: entry.commissionAvailableDeltaMinor,
        }))
        .sort((a, b) => a.eventType.localeCompare(b.eventType)),
    ).toEqual([
      {
        eventType: 'COMMISSION_FROZEN',
        frozen: 600,
        available: 0,
      },
      {
        eventType: 'COMMISSION_SETTLED',
        frozen: -600,
        available: 600,
      },
    ]);
  });

  it('freezes from explicit active policy once and settles through append-only ledger', async () => {
    const fixture = await paidAttribution();
    await db.transaction((tx) =>
      service.freezeForPaidOrder(tx, fixture.order.id, fixture.order.id),
    );
    expect(await db.select().from(commissionEvents)).toHaveLength(1);
    let account = await service.getAccount(fixture.beneficiary.id);
    expect(account).toMatchObject({ frozenMinor: 600, availableMinor: 0 });
    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));
    await service.settle(frozen!.id);
    await service.settle(frozen!.id);
    account = await service.getAccount(fixture.beneficiary.id);
    expect(account).toMatchObject({ frozenMinor: 0, availableMinor: 600 });
  });

  it('refund reversal debits frozen commission and is idempotent', async () => {
    const fixture = await paidAttribution(10);
    const admin = await operator();
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: fixture.order.id,
        merchantId: 'm',
        appId: 'a',
        outTradeNo: randomUUID(),
        amountMinor: 10000,
        status: 'SUCCEEDED',
        providerTransactionId: randomUUID(),
      })
      .returning();
    const [refund] = await db
      .insert(refunds)
      .values({
        paymentId: payment!.id,
        outRefundNo: randomUUID(),
        amountMinor: 10000,
        status: 'SUCCEEDED',
        requestedBy: admin.id,
        originalOrderStatus: 'PAID',
      })
      .returning();
    await db.transaction((tx) =>
      service.reverseForRefund(tx, fixture.order.id, refund!.id, 10000, 10000),
    );
    await db.transaction((tx) =>
      service.reverseForRefund(tx, fixture.order.id, refund!.id, 10000, 10000),
    );
    expect(await service.getAccount(fixture.beneficiary.id)).toMatchObject({
      frozenMinor: 0,
      availableMinor: 0,
    });
    expect(await db.select().from(commissionLedger)).toHaveLength(2);
  });

  it('blocks payout and releases the hold when settled commission is reversed before payout', async () => {
    const fixture = await paidAttribution();

    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));

    await service.settle(frozen!.id);

    const withdrawal = await service.createWithdrawal(
      fixture.beneficiary.id,
      600,
      'refund-before-payout',
    );

    const reviewer = await operator();

    const approved = await service.reviewWithdrawal(withdrawal.id, reviewer.id, {
      action: 'APPROVE',
      version: withdrawal.version,
    });

    expect(approved.status).toBe('APPROVED');

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: fixture.order.id,
        merchantId: 'm',
        appId: 'a',
        outTradeNo: randomUUID(),
        amountMinor: 10000,
        status: 'SUCCEEDED',
        providerTransactionId: randomUUID(),
      })
      .returning();

    const [refund] = await db
      .insert(refunds)
      .values({
        paymentId: payment!.id,
        outRefundNo: randomUUID(),
        amountMinor: 10000,
        status: 'SUCCEEDED',
        requestedBy: reviewer.id,
        originalOrderStatus: 'PAID',
      })
      .returning();

    await db.transaction((tx) =>
      service.reverseForRefund(
        tx,
        fixture.order.id,
        refund!.id,
        refund!.amountMinor,
        payment!.amountMinor,
      ),
    );

    expect(await service.getAccount(fixture.beneficiary.id)).toMatchObject({
      frozenMinor: 0,
      availableMinor: -600,
    });

    const blocked = await service.reviewWithdrawal(withdrawal.id, reviewer.id, {
      action: 'MARK_PAID',
      version: approved.version,
    });

    expect(blocked.status).toBe('REJECTED');
    expect(blocked.paidAt).toBeNull();

    expect(await service.getAccount(fixture.beneficiary.id)).toMatchObject({
      frozenMinor: 0,
      availableMinor: 0,
    });

    const events = await db.select().from(commissionEvents);

    expect(
      events.filter(
        (event) => event.withdrawalRequestId === withdrawal.id && event.type === 'WITHDRAWAL_PAID',
      ),
    ).toHaveLength(0);

    expect(
      events.filter(
        (event) =>
          event.withdrawalRequestId === withdrawal.id && event.type === 'WITHDRAWAL_RELEASED',
      ),
    ).toHaveLength(1);
  });

  it('serializes concurrent approve and reject decisions with optimistic locking', async () => {
    const fixture = await paidAttribution();

    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));

    await service.settle(frozen!.id);

    const withdrawal = await service.createWithdrawal(
      fixture.beneficiary.id,
      400,
      'concurrent-review',
    );

    const reviewerA = await operator();
    const reviewerB = await operator();

    const results = await Promise.allSettled([
      service.reviewWithdrawal(withdrawal.id, reviewerA.id, {
        action: 'APPROVE',
        version: withdrawal.version,
      }),
      service.reviewWithdrawal(withdrawal.id, reviewerB.id, {
        action: 'REJECT',
        version: withdrawal.version,
      }),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.reviewWithdrawal>>> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'STALE_VERSION' });

    const [stored] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, withdrawal.id));

    expect(['APPROVED', 'REJECTED']).toContain(stored!.status);
    expect(stored!.version).toBe(withdrawal.version + 1);

    const reviewEvents = (await db.select().from(commissionEvents)).filter(
      (event) =>
        event.withdrawalRequestId === withdrawal.id &&
        ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_RELEASED'].includes(event.type),
    );

    expect(reviewEvents).toHaveLength(1);

    const account = await service.getAccount(fixture.beneficiary.id);
    expect(account.availableMinor).toBe(stored!.status === 'REJECTED' ? 600 : 200);
  });

  it('rejects an explicit stale withdrawal review version without changing state twice', async () => {
    const fixture = await paidAttribution();

    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));

    await service.settle(frozen!.id);

    const withdrawal = await service.createWithdrawal(fixture.beneficiary.id, 300, 'stale-review');

    const reviewer = await operator();

    const approved = await service.reviewWithdrawal(withdrawal.id, reviewer.id, {
      action: 'APPROVE',
      version: withdrawal.version,
    });

    expect(approved.status).toBe('APPROVED');
    expect(approved.version).toBe(withdrawal.version + 1);

    await expect(
      service.reviewWithdrawal(withdrawal.id, reviewer.id, {
        action: 'REJECT',
        version: withdrawal.version,
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });

    const [stored] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, withdrawal.id));

    expect(stored!.status).toBe('APPROVED');
    expect(stored!.version).toBe(withdrawal.version + 1);

    const reviewEvents = (await db.select().from(commissionEvents)).filter(
      (event) =>
        event.withdrawalRequestId === withdrawal.id &&
        ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_RELEASED'].includes(event.type),
    );

    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]!.type).toBe('WITHDRAWAL_APPROVED');
  });

  it('concurrent withdrawal requests cannot spend the same available balance twice', async () => {
    const fixture = await paidAttribution();
    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));
    await service.settle(frozen!.id);
    const results = await Promise.allSettled([
      service.createWithdrawal(fixture.beneficiary.id, 500, 'withdrawal-a'),
      service.createWithdrawal(fixture.beneficiary.id, 500, 'withdrawal-b'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(withdrawalRequests)).toHaveLength(1);
    expect((await service.getAccount(fixture.beneficiary.id)).availableMinor).toBe(100);
  });

  it('withdrawal idempotency and cancellation release exactly once', async () => {
    const fixture = await paidAttribution();
    const [frozen] = await db
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.type, 'FROZEN'));
    await service.settle(frozen!.id);
    const first = await service.createWithdrawal(fixture.beneficiary.id, 400, 'same-request');
    expect((await service.createWithdrawal(fixture.beneficiary.id, 400, 'same-request')).id).toBe(
      first.id,
    );
    await service.cancelWithdrawal(fixture.beneficiary.id, first.id);
    await service.cancelWithdrawal(fixture.beneficiary.id, first.id);
    expect((await service.getAccount(fixture.beneficiary.id)).availableMinor).toBe(600);
    expect(await db.select().from(commissionLedger)).toHaveLength(4);
  });
});
