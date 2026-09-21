import { eq } from 'drizzle-orm';
import type { commissionEvents, paymentLedger } from '@xiaohai/db';
import {
  commissionEvents as commissionEventsTable,
  commissionLedger,
  financeLedgerEntries,
  paymentLedger as paymentLedgerTable,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PaymentLedgerEntry = typeof paymentLedger.$inferSelect;
type CommissionEvent = typeof commissionEvents.$inferSelect;

interface CommissionMovement {
  cashDeltaMinor?: number;
  frozenDeltaMinor?: number;
  availableDeltaMinor?: number;
}

export interface FinanceBackfillOptions {
  sourceKind?: 'PAYMENT_LEDGER' | 'COMMISSION_EVENT';
}

export interface FinanceBackfillResult {
  paymentSources: number;
  commissionSources: number;
  insertedEntries: number;
}

const commissionFinanceEventType = {
  FROZEN: 'COMMISSION_FROZEN',
  SETTLED: 'COMMISSION_SETTLED',
  REVERSED: 'COMMISSION_REVERSED',
  WITHDRAWAL_HELD: 'WITHDRAWAL_HELD',
  WITHDRAWAL_RELEASED: 'WITHDRAWAL_RELEASED',
  WITHDRAWAL_PAID: 'WITHDRAWAL_PAID',
} as const;

/**
 * M21 finance ledger is a normalized append-only projection of the authoritative
 * M6 payment ledger and M18 commission event/ledger. Projection writes must run
 * in the same database transaction as their source write.
 */
export async function projectPaymentLedgerEntry(
  tx: Tx,
  source: PaymentLedgerEntry,
): Promise<number> {
  const inserted = await tx
    .insert(financeLedgerEntries)
    .values({
      eventKey: `payment-ledger:${source.eventKey}`,
      sourceKind: 'PAYMENT_LEDGER',
      paymentLedgerId: source.id,
      eventType: source.kind,
      cashDeltaMinor: source.kind === 'PAYMENT' ? source.amountMinor : -source.amountMinor,
      occurredAt: source.createdAt,
    })
    .onConflictDoNothing()
    .returning({ id: financeLedgerEntries.id });

  return inserted.length;
}

export async function projectCommissionEvent(
  tx: Tx,
  source: CommissionEvent,
  movement: CommissionMovement = {},
): Promise<number> {
  const mapped = commissionFinanceEventType[source.type as keyof typeof commissionFinanceEventType];
  if (!mapped) return 0;

  const cashDeltaMinor =
    movement.cashDeltaMinor ?? (source.type === 'WITHDRAWAL_PAID' ? -source.amountMinor : 0);
  const commissionFrozenDeltaMinor = movement.frozenDeltaMinor ?? 0;
  const commissionAvailableDeltaMinor = movement.availableDeltaMinor ?? 0;

  if (
    cashDeltaMinor === 0 &&
    commissionFrozenDeltaMinor === 0 &&
    commissionAvailableDeltaMinor === 0
  ) {
    throw new Error(`Finance projection requires a non-zero movement for ${source.type}`);
  }

  const inserted = await tx
    .insert(financeLedgerEntries)
    .values({
      eventKey: `commission-event:${source.eventKey}`,
      sourceKind: 'COMMISSION_EVENT',
      commissionEventId: source.id,
      eventType: mapped,
      cashDeltaMinor,
      commissionFrozenDeltaMinor,
      commissionAvailableDeltaMinor,
      occurredAt: source.createdAt,
    })
    .onConflictDoNothing()
    .returning({ id: financeLedgerEntries.id });

  return inserted.length;
}

/**
 * Explicit, retry-safe historical projector for development/staging upgrades.
 * It copies only authoritative source movements and never recalculates payment
 * or commission business rules. Reconciliation remains read-only evidence and
 * must not invoke this helper implicitly.
 */
export async function backfillFinanceLedger(
  db: Db,
  options: FinanceBackfillOptions = {},
): Promise<FinanceBackfillResult> {
  return db.transaction(async (tx) => {
    let paymentSources = 0;
    let commissionSources = 0;
    let insertedEntries = 0;

    if (!options.sourceKind || options.sourceKind === 'PAYMENT_LEDGER') {
      const sources = await tx.select().from(paymentLedgerTable).orderBy(paymentLedgerTable.createdAt);
      paymentSources = sources.length;

      for (const source of sources) insertedEntries += await projectPaymentLedgerEntry(tx, source);
    }

    if (!options.sourceKind || options.sourceKind === 'COMMISSION_EVENT') {
      const sources = await tx
        .select({ event: commissionEventsTable, ledger: commissionLedger })
        .from(commissionEventsTable)
        .leftJoin(commissionLedger, eq(commissionLedger.eventId, commissionEventsTable.id))
        .orderBy(commissionEventsTable.createdAt);

      for (const { event, ledger } of sources) {
        if (event.type === 'WITHDRAWAL_APPROVED') continue;

        commissionSources += 1;

        if (event.type === 'WITHDRAWAL_PAID') {
          insertedEntries += await projectCommissionEvent(tx, event);
          continue;
        }

        if (!ledger) {
          throw new Error(`Missing commission ledger movement for event ${event.id}`);
        }

        insertedEntries += await projectCommissionEvent(tx, event, {
          frozenDeltaMinor: ledger.frozenDeltaMinor,
          availableDeltaMinor: ledger.availableDeltaMinor,
        });
      }
    }

    return { paymentSources, commissionSources, insertedEntries };
  });
}
