import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type {
  CreateFinanceReconciliationRunRequest,
  FinanceEventType,
  FinanceExportRequest,
  FinanceLedgerListQuery,
  FinanceSummaryQuery,
} from '@xiaohai/contracts/finance';
import {
  auditLogs,
  commissionEvents,
  commissionLedger,
  financeLedgerEntries,
  financeReconciliationItems,
  financeReconciliationRuns,
  paymentLedger,
  type createDatabase,
} from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];
type FinanceEntry = typeof financeLedgerEntries.$inferSelect;
type CommissionEvent = typeof commissionEvents.$inferSelect;
type CommissionLedger = typeof commissionLedger.$inferSelect;

const commissionEventTypes = {
  FROZEN: 'COMMISSION_FROZEN',
  SETTLED: 'COMMISSION_SETTLED',
  REVERSED: 'COMMISSION_REVERSED',
  WITHDRAWAL_HELD: 'WITHDRAWAL_HELD',
  WITHDRAWAL_RELEASED: 'WITHDRAWAL_RELEASED',
  WITHDRAWAL_PAID: 'WITHDRAWAL_PAID',
} as const satisfies Record<string, FinanceEventType>;

interface ExpectedMovement {
  sourceKind: 'PAYMENT_LEDGER' | 'COMMISSION_EVENT';
  sourceId: string;
  eventKey: string;
  eventType: FinanceEventType;
  cashDeltaMinor: number;
  commissionFrozenDeltaMinor: number;
  commissionAvailableDeltaMinor: number;
  sourceIncomplete?: boolean;
}

export class FinanceServiceError extends Error {
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
  }
}

export class FinanceService {
  constructor(private readonly db: Database) {}

  async getSummary(input: FinanceSummaryQuery) {
    const [row] = await this.db
      .select({
        cashInflowMinor: sql<string>`coalesce(sum(case when ${financeLedgerEntries.cashDeltaMinor} > 0 then ${financeLedgerEntries.cashDeltaMinor}::numeric else 0::numeric end), 0)::text`,
        cashOutflowMinor: sql<string>`coalesce(sum(case when ${financeLedgerEntries.cashDeltaMinor} < 0 then -${financeLedgerEntries.cashDeltaMinor}::numeric else 0::numeric end), 0)::text`,
        netCashMinor: sql<string>`coalesce(sum(${financeLedgerEntries.cashDeltaMinor}::numeric), 0)::text`,
        commissionFrozenDeltaMinor: sql<string>`coalesce(sum(${financeLedgerEntries.commissionFrozenDeltaMinor}::numeric), 0)::text`,
        commissionAvailableDeltaMinor: sql<string>`coalesce(sum(${financeLedgerEntries.commissionAvailableDeltaMinor}::numeric), 0)::text`,
      })
      .from(financeLedgerEntries)
      .where(
        and(
          input.from ? gte(financeLedgerEntries.occurredAt, new Date(input.from)) : undefined,
          input.to ? lte(financeLedgerEntries.occurredAt, new Date(input.to)) : undefined,
        ),
      );

    return {
      cashInflowMinor: financeAggregateMinor(row?.cashInflowMinor),
      cashOutflowMinor: financeAggregateMinor(row?.cashOutflowMinor),
      netCashMinor: financeAggregateMinor(row?.netCashMinor),
      commissionFrozenDeltaMinor: financeAggregateMinor(row?.commissionFrozenDeltaMinor),
      commissionAvailableDeltaMinor: financeAggregateMinor(row?.commissionAvailableDeltaMinor),
      currency: 'CNY' as const,
    };
  }

  async listLedger(input: FinanceLedgerListQuery) {
    const rows = await this.db
      .select()
      .from(financeLedgerEntries)
      .where(
        and(
          input.from ? gte(financeLedgerEntries.occurredAt, new Date(input.from)) : undefined,
          input.to ? lte(financeLedgerEntries.occurredAt, new Date(input.to)) : undefined,
          input.sourceKind ? eq(financeLedgerEntries.sourceKind, input.sourceKind) : undefined,
          input.eventType ? eq(financeLedgerEntries.eventType, input.eventType) : undefined,
        ),
      )
      .orderBy(desc(financeLedgerEntries.occurredAt), desc(financeLedgerEntries.id))
      .limit(input.limit);

    return { items: rows.map(serializeFinanceEntry) };
  }

  async exportLedger(actorStaffAccountId: string, requestId: string, input: FinanceExportRequest) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(financeLedgerEntries)
        .where(
          and(
            gte(financeLedgerEntries.occurredAt, new Date(input.from)),
            lte(financeLedgerEntries.occurredAt, new Date(input.to)),
            input.sourceKind ? eq(financeLedgerEntries.sourceKind, input.sourceKind) : undefined,
            input.eventType ? eq(financeLedgerEntries.eventType, input.eventType) : undefined,
          ),
        )
        .orderBy(financeLedgerEntries.occurredAt, financeLedgerEntries.id)
        .limit(input.limit);

      await tx.insert(auditLogs).values({
        actorStaffAccountId,
        actionKey: 'finance.export',
        resourceType: 'FINANCE_EXPORT',
        resourceId: null,
        requestId,
        metadata: {
          from: input.from,
          to: input.to,
          sourceKind: input.sourceKind ?? null,
          eventType: input.eventType ?? null,
          limit: input.limit,
          exportedRowCount: rows.length,
        },
      });

      return {
        csv: financeCsv(rows),
        rowCount: rows.length,
        filename: `finance-ledger-${dateStamp(input.from)}-${dateStamp(input.to)}.csv`,
      };
    });
  }

  async getReconciliationRun(id: string) {
    const [run] = await this.db
      .select()
      .from(financeReconciliationRuns)
      .where(eq(financeReconciliationRuns.id, id))
      .limit(1);
    if (!run) throw new FinanceServiceError('NOT_FOUND');

    const items = await this.db
      .select()
      .from(financeReconciliationItems)
      .where(eq(financeReconciliationItems.runId, id))
      .orderBy(financeReconciliationItems.createdAt, financeReconciliationItems.id);

    return serializeRun(run, items);
  }

  async createReconciliationRun(
    requestedByStaffAccountId: string,
    input: CreateFinanceReconciliationRunRequest,
    requestId = 'internal',
  ) {
    const rangeFrom = new Date(input.from);
    const rangeTo = new Date(input.to);
    const [run] = await this.db
      .insert(financeReconciliationRuns)
      .values({ requestedByStaffAccountId, rangeFrom, rangeTo })
      .returning();
    if (!run) throw new Error('Failed to create finance reconciliation run');

    try {
      await this.db.transaction(async (tx) => {
        const paymentSources = await tx
          .select()
          .from(paymentLedger)
          .where(
            and(gte(paymentLedger.createdAt, rangeFrom), lte(paymentLedger.createdAt, rangeTo)),
          );

        const commissionSources = await tx
          .select({ event: commissionEvents, ledger: commissionLedger })
          .from(commissionEvents)
          .leftJoin(commissionLedger, eq(commissionLedger.eventId, commissionEvents.id))
          .where(
            and(
              gte(commissionEvents.createdAt, rangeFrom),
              lte(commissionEvents.createdAt, rangeTo),
            ),
          );

        const actualEntries = await tx
          .select()
          .from(financeLedgerEntries)
          .where(
            and(
              gte(financeLedgerEntries.occurredAt, rangeFrom),
              lte(financeLedgerEntries.occurredAt, rangeTo),
            ),
          );

        const paymentActual = new Map<string, FinanceEntry>(
          actualEntries
            .filter((entry) => entry.paymentLedgerId)
            .map((entry) => [entry.paymentLedgerId!, entry] as const),
        );
        const commissionActual = new Map<string, FinanceEntry>(
          actualEntries
            .filter((entry) => entry.commissionEventId)
            .map((entry) => [entry.commissionEventId!, entry] as const),
        );

        const expected: ExpectedMovement[] = paymentSources.map((source) => ({
          sourceKind: 'PAYMENT_LEDGER',
          sourceId: source.id,
          eventKey: source.eventKey,
          eventType: source.kind as FinanceEventType,
          cashDeltaMinor: source.kind === 'PAYMENT' ? source.amountMinor : -source.amountMinor,
          commissionFrozenDeltaMinor: 0,
          commissionAvailableDeltaMinor: 0,
        }));

        for (const source of commissionSources) {
          const movement = expectedCommissionMovement(source.event, source.ledger);
          if (movement) expected.push(movement);
        }

        let matchedCount = 0;
        let missingCount = 0;
        let mismatchCount = 0;
        const itemValues = expected.map((movement) => {
          const actual =
            movement.sourceKind === 'PAYMENT_LEDGER'
              ? paymentActual.get(movement.sourceId)
              : commissionActual.get(movement.sourceId);
          const outcome = reconciliationOutcome(movement, actual);
          if (outcome === 'MATCHED') matchedCount += 1;
          else if (outcome === 'MISSING') missingCount += 1;
          else mismatchCount += 1;

          return {
            runId: run.id,
            sourceKind: movement.sourceKind,
            sourceId: movement.sourceId,
            eventKey: movement.eventKey,
            eventType: movement.eventType,
            financeLedgerEntryId: actual?.id ?? null,
            outcome,
            expectedCashDeltaMinor: movement.cashDeltaMinor,
            actualCashDeltaMinor: actual?.cashDeltaMinor ?? null,
            expectedCommissionFrozenDeltaMinor: movement.commissionFrozenDeltaMinor,
            actualCommissionFrozenDeltaMinor: actual?.commissionFrozenDeltaMinor ?? null,
            expectedCommissionAvailableDeltaMinor: movement.commissionAvailableDeltaMinor,
            actualCommissionAvailableDeltaMinor: actual?.commissionAvailableDeltaMinor ?? null,
          };
        });

        if (itemValues.length > 0) await tx.insert(financeReconciliationItems).values(itemValues);
        await tx
          .update(financeReconciliationRuns)
          .set({
            status: 'COMPLETED',
            matchedCount,
            missingCount,
            mismatchCount,
            completedAt: new Date(),
          })
          .where(eq(financeReconciliationRuns.id, run.id));

        await tx.insert(auditLogs).values({
          actorStaffAccountId: requestedByStaffAccountId,
          actionKey: 'finance.reconcile',
          resourceType: 'FINANCE_RECONCILIATION',
          resourceId: run.id,
          requestId,
          metadata: {
            from: input.from,
            to: input.to,
            matchedCount,
            missingCount,
            mismatchCount,
          },
        });
      });
    } catch (error) {
      await this.db
        .update(financeReconciliationRuns)
        .set({ status: 'FAILED', completedAt: new Date() })
        .where(eq(financeReconciliationRuns.id, run.id));
      throw error;
    }

    return this.getReconciliationRun(run.id);
  }
}

function financeAggregateMinor(value: string | null | undefined): number {
  const exact = BigInt(value ?? '0');
  const safeLimit = BigInt(Number.MAX_SAFE_INTEGER);

  if (exact > safeLimit || exact < -safeLimit) {
    throw new Error('Finance aggregate exceeds JavaScript safe integer range');
  }

  return Number(exact);
}

function expectedCommissionMovement(
  event: CommissionEvent,
  ledger: CommissionLedger | null,
): ExpectedMovement | null {
  if (event.type === 'WITHDRAWAL_APPROVED') return null;
  const eventType = commissionEventTypes[event.type as keyof typeof commissionEventTypes];
  if (!eventType) return null;

  if (event.type === 'WITHDRAWAL_PAID') {
    return {
      sourceKind: 'COMMISSION_EVENT',
      sourceId: event.id,
      eventKey: event.eventKey,
      eventType,
      cashDeltaMinor: -event.amountMinor,
      commissionFrozenDeltaMinor: 0,
      commissionAvailableDeltaMinor: 0,
    };
  }

  return {
    sourceKind: 'COMMISSION_EVENT',
    sourceId: event.id,
    eventKey: event.eventKey,
    eventType,
    cashDeltaMinor: 0,
    commissionFrozenDeltaMinor: ledger?.frozenDeltaMinor ?? 0,
    commissionAvailableDeltaMinor: ledger?.availableDeltaMinor ?? 0,
    sourceIncomplete: !ledger,
  };
}

function reconciliationOutcome(
  expected: ExpectedMovement,
  actual: FinanceEntry | undefined,
): 'MATCHED' | 'MISSING' | 'MISMATCH' {
  if (expected.sourceIncomplete) return 'MISMATCH';
  if (!actual) return 'MISSING';
  return actual.eventType === expected.eventType &&
    actual.cashDeltaMinor === expected.cashDeltaMinor &&
    actual.commissionFrozenDeltaMinor === expected.commissionFrozenDeltaMinor &&
    actual.commissionAvailableDeltaMinor === expected.commissionAvailableDeltaMinor
    ? 'MATCHED'
    : 'MISMATCH';
}

function serializeFinanceEntry(row: FinanceEntry) {
  return {
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeRun(
  run: typeof financeReconciliationRuns.$inferSelect,
  items: Array<typeof financeReconciliationItems.$inferSelect>,
) {
  return {
    ...run,
    rangeFrom: run.rangeFrom.toISOString(),
    rangeTo: run.rangeTo.toISOString(),
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
  };
}

function financeCsv(rows: FinanceEntry[]): string {
  const header = [
    'id',
    'event_key',
    'source_kind',
    'source_id',
    'event_type',
    'currency',
    'cash_delta_minor',
    'commission_frozen_delta_minor',
    'commission_available_delta_minor',
    'occurred_at',
    'created_at',
  ].join(',');

  const lines = rows.map((row) =>
    [
      csvText(row.id),
      csvText(row.eventKey),
      csvText(row.sourceKind),
      csvText(row.paymentLedgerId ?? row.commissionEventId ?? ''),
      csvText(row.eventType),
      csvText(row.currency),
      row.cashDeltaMinor,
      row.commissionFrozenDeltaMinor,
      row.commissionAvailableDeltaMinor,
      csvText(row.occurredAt.toISOString()),
      csvText(row.createdAt.toISOString()),
    ].join(','),
  );

  return `${[header, ...lines].join('\n')}\n`;
}

function csvText(value: string): string {
  const hardened = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${hardened.replaceAll('"', '""')}"`;
}

function dateStamp(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
