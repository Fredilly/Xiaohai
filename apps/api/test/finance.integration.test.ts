import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  consumerUsers,
  createDatabase,
  financeLedgerEntries,
  financeReconciliationItems,
  financeReconciliationRuns,
  orders,
  paymentLedger,
  payments,
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import {
  FINANCE_EXPORT_PERMISSION,
  FINANCE_READ_PERMISSION,
  FINANCE_RECONCILE_PERMISSION,
  registerFinanceRoutes,
} from '../src/finance/finance-routes.js';
import { FinanceService } from '../src/finance/finance-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M21 finance PostgreSQL integration', () => {
  const db = database!.db;
  const finance = new FinanceService(db);
  const staffSessions = new StaffSessionService(
    'm21-finance-staff-session-secret-at-least-32-characters',
    300,
  );
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(db),
    staffSessions,
  );
  const consumers: string[] = [];
  const staff: string[] = [];
  const testRoles: string[] = [];

  async function cleanup() {
    await db.delete(auditLogs).where(eq(auditLogs.actionKey, 'finance.export'));
    await db.delete(auditLogs).where(eq(auditLogs.actionKey, 'finance.reconcile'));
    await db.delete(financeReconciliationItems);
    await db.delete(financeReconciliationRuns);
    await db.delete(financeLedgerEntries);
    await db.delete(paymentLedger);
    await db.delete(payments);

    for (const id of consumers.splice(0)) {
      await db.delete(orders).where(eq(orders.consumerUserId, id));
      await db.delete(consumerUsers).where(eq(consumerUsers.id, id));
    }
    for (const id of testRoles) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await db.delete(staffRoles).where(eq(staffRoles.roleId, id));
    }
    for (const id of staff) {
      await db.delete(staffDataScopes).where(eq(staffDataScopes.staffAccountId, id));
    }
    for (const id of testRoles.splice(0)) await db.delete(roles).where(eq(roles.id, id));
    for (const id of staff.splice(0))
      await db.delete(staffAccounts).where(eq(staffAccounts.id, id));
  }

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await database!.pool.end();
  });

  async function staffToken(permission: string, global: boolean) {
    const [account] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'test-only' })
      .returning();
    staff.push(account!.id);

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
      .values({ key: `m21-${randomUUID()}`, displayName: 'M21 finance test' })
      .returning();
    testRoles.push(role!.id);
    await db.insert(staffRoles).values({ staffAccountId: account!.id, roleId: role!.id });
    await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permissionRow!.id });
    await db.insert(staffDataScopes).values({
      staffAccountId: account!.id,
      scopeType: global ? 'GLOBAL' : 'REGION',
      scopeId: global ? null : randomUUID(),
    });

    return { account: account!, token: staffSessions.issue(account!.id).token };
  }

  async function paymentSource(amountMinor = 2500) {
    const [user] = await db.insert(consumerUsers).values({}).returning();
    consumers.push(user!.id);
    const [order] = await db
      .insert(orders)
      .values({
        consumerUserId: user!.id,
        orderNumber: randomUUID(),
        subtotalMinor: amountMinor,
        totalMinor: amountMinor,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: order!.id,
        merchantId: 'm21-merchant-secret-marker',
        appId: 'm21-app-sensitive-marker',
        outTradeNo: randomUUID(),
        amountMinor,
      })
      .returning();
    const [ledger] = await db
      .insert(paymentLedger)
      .values({
        paymentId: payment!.id,
        eventKey: `m21-payment-${randomUUID()}`,
        kind: 'PAYMENT',
        amountMinor,
      })
      .returning();
    return ledger!;
  }

  function range() {
    const now = Date.now();
    return {
      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    };
  }

  it('requires explicit finance permissions and GLOBAL Data Scope', async () => {
    const app = buildApp({ logger: false });
    registerFinanceRoutes(app, { finance, staffAuthorization: authorization });

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/staff/finance/summary' })).statusCode,
    ).toBe(401);

    const wrong = await staffToken('finance.unrelated', true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/finance/summary',
          headers: { authorization: `Bearer ${wrong.token}` },
        })
      ).statusCode,
    ).toBe(403);

    const regional = await staffToken(FINANCE_READ_PERMISSION, false);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/finance/summary',
          headers: { authorization: `Bearer ${regional.token}` },
        })
      ).statusCode,
    ).toBe(403);

    const reader = await staffToken(FINANCE_READ_PERMISSION, true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/finance/summary',
          headers: { authorization: `Bearer ${reader.token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/staff/finance/exports',
          headers: { authorization: `Bearer ${reader.token}` },
          payload: range(),
        })
      ).statusCode,
    ).toBe(403);

    const reconciler = await staffToken(FINANCE_RECONCILE_PERMISSION, true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/staff/finance/reconciliation-runs',
          headers: { authorization: `Bearer ${reconciler.token}` },
          payload: range(),
        })
      ).statusCode,
    ).toBe(201);

    const exporter = await staffToken(FINANCE_EXPORT_PERMISSION, true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/staff/finance/exports',
          headers: { authorization: `Bearer ${exporter.token}` },
          payload: range(),
        })
      ).statusCode,
    ).toBe(200);

    await app.close();
  });

  it('returns server-derived summary and filtered ledger rows', async () => {
    const source = await paymentSource();
    await db.insert(financeLedgerEntries).values({
      eventKey: `payment-ledger:${source.eventKey}`,
      sourceKind: 'PAYMENT_LEDGER',
      paymentLedgerId: source.id,
      eventType: 'PAYMENT',
      cashDeltaMinor: 2500,
      occurredAt: source.createdAt,
    });

    expect(await finance.getSummary(range())).toMatchObject({
      cashInflowMinor: 2500,
      cashOutflowMinor: 0,
      netCashMinor: 2500,
      commissionFrozenDeltaMinor: 0,
      commissionAvailableDeltaMinor: 0,
      currency: 'CNY',
    });
    const ledger = await finance.listLedger({
      ...range(),
      sourceKind: 'PAYMENT_LEDGER',
      eventType: 'PAYMENT',
      limit: 10,
    });
    expect(ledger.items).toHaveLength(1);
    expect(ledger.items[0]).toMatchObject({ paymentLedgerId: source.id, cashDeltaMinor: 2500 });
  });

  it('aggregates finance summary safely above the PostgreSQL int32 boundary', async () => {
    const amountMinor = 1_500_000_000;
    const sourceA = await paymentSource(amountMinor);
    const sourceB = await paymentSource(amountMinor);

    await db.insert(financeLedgerEntries).values([
      {
        eventKey: `payment-ledger:${sourceA.eventKey}`,
        sourceKind: 'PAYMENT_LEDGER',
        paymentLedgerId: sourceA.id,
        eventType: 'PAYMENT',
        cashDeltaMinor: amountMinor,
        occurredAt: sourceA.createdAt,
      },
      {
        eventKey: `payment-ledger:${sourceB.eventKey}`,
        sourceKind: 'PAYMENT_LEDGER',
        paymentLedgerId: sourceB.id,
        eventType: 'PAYMENT',
        cashDeltaMinor: amountMinor,
        occurredAt: sourceB.createdAt,
      },
    ]);

    const totalMinor = amountMinor * 2;
    expect(totalMinor).toBeGreaterThan(2_147_483_647);
    expect(await finance.getSummary(range())).toMatchObject({
      cashInflowMinor: 3_000_000_000,
      cashOutflowMinor: 0,
      netCashMinor: 3_000_000_000,
      currency: 'CNY',
    });
  });

  it('persists missing reconciliation evidence and audit without repairing the finance ledger', async () => {
    const source = await paymentSource();
    const actor = await staffToken(FINANCE_RECONCILE_PERMISSION, true);
    const sourceBefore = await db
      .select()
      .from(paymentLedger)
      .where(eq(paymentLedger.id, source.id));

    const run = await finance.createReconciliationRun(
      actor.account.id,
      range(),
      'm21-reconcile-test-request',
    );

    expect(run).toMatchObject({
      status: 'COMPLETED',
      matchedCount: 0,
      missingCount: 1,
      mismatchCount: 0,
    });
    expect(run.items).toHaveLength(1);
    expect(run.items?.[0]).toMatchObject({
      sourceKind: 'PAYMENT_LEDGER',
      sourceId: source.id,
      outcome: 'MISSING',
      expectedCashDeltaMinor: 2500,
      actualCashDeltaMinor: null,
    });
    expect(await db.select().from(financeLedgerEntries)).toHaveLength(0);
    expect(await db.select().from(paymentLedger).where(eq(paymentLedger.id, source.id))).toEqual(
      sourceBefore,
    );

    const reconciliationAudit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actionKey, 'finance.reconcile'));
    expect(reconciliationAudit).toHaveLength(1);
    expect(reconciliationAudit[0]).toMatchObject({
      actorStaffAccountId: actor.account.id,
      resourceType: 'FINANCE_RECONCILIATION',
      resourceId: run.id,
      requestId: 'm21-reconcile-test-request',
    });
  });

  it('persists amount mismatches and leaves existing finance history unchanged', async () => {
    const source = await paymentSource();
    const [financeEntry] = await db
      .insert(financeLedgerEntries)
      .values({
        eventKey: `payment-ledger:${source.eventKey}`,
        sourceKind: 'PAYMENT_LEDGER',
        paymentLedgerId: source.id,
        eventType: 'PAYMENT',
        cashDeltaMinor: 1,
        occurredAt: source.createdAt,
      })
      .returning();
    const actor = await staffToken(FINANCE_RECONCILE_PERMISSION, true);

    const run = await finance.createReconciliationRun(
      actor.account.id,
      range(),
      'm21-mismatch-test',
    );

    expect(run).toMatchObject({
      status: 'COMPLETED',
      matchedCount: 0,
      missingCount: 0,
      mismatchCount: 1,
    });
    expect(run.items?.[0]).toMatchObject({
      outcome: 'MISMATCH',
      expectedCashDeltaMinor: 2500,
      actualCashDeltaMinor: 1,
      financeLedgerEntryId: financeEntry!.id,
    });
    expect((await db.select().from(financeLedgerEntries))[0]).toMatchObject({
      id: financeEntry!.id,
      cashDeltaMinor: 1,
    });
  });

  it('exports bounded finance CSV and audits filters without leaking sensitive payment fields', async () => {
    const source = await paymentSource();
    const [entry] = await db
      .insert(financeLedgerEntries)
      .values({
        eventKey: `payment-ledger:${source.eventKey}`,
        sourceKind: 'PAYMENT_LEDGER',
        paymentLedgerId: source.id,
        eventType: 'PAYMENT',
        cashDeltaMinor: 2500,
        occurredAt: source.createdAt,
      })
      .returning();
    const exporter = await staffToken(FINANCE_EXPORT_PERMISSION, true);
    const app = buildApp({ logger: false });
    registerFinanceRoutes(app, { finance, staffAuthorization: authorization });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/finance/exports',
      headers: { authorization: `Bearer ${exporter.token}` },
      payload: {
        ...range(),
        sourceKind: 'PAYMENT_LEDGER',
        eventType: 'PAYMENT',
        limit: 10,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('finance-ledger-');
    expect(response.headers['x-exported-row-count']).toBe('1');
    expect(response.body).toContain('event_key,source_kind,source_id,event_type');
    expect(response.body).toContain(entry!.id);
    expect(response.body).toContain(source.id);
    expect(response.body).not.toContain('m21-merchant-secret-marker');
    expect(response.body).not.toContain('m21-app-sensitive-marker');

    const exportAudit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actionKey, 'finance.export'));
    expect(exportAudit).toHaveLength(1);
    expect(exportAudit[0]).toMatchObject({
      actorStaffAccountId: exporter.account.id,
      resourceType: 'FINANCE_EXPORT',
    });
    expect(exportAudit[0]?.metadata).toMatchObject({
      sourceKind: 'PAYMENT_LEDGER',
      eventType: 'PAYMENT',
      limit: 10,
      exportedRowCount: 1,
    });

    await app.close();
  });
});
