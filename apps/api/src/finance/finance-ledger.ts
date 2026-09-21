import { commissionEvents, financeLedgerEntries, paymentLedger, type createDatabase } from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PaymentLedgerEntry = typeof paymentLedger.$inferSelect;
type CommissionEvent = typeof commissionEvents.$inferSelect;

interface CommissionMovement {
  cashDeltaMinor?: number;
  frozenDeltaMinor?: number;
  availableDeltaMinor?: number;
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
export async function projectPaymentLedgerEntry(tx: Tx, source: PaymentLedgerEntry) {
  await tx
    .insert(financeLedgerEntries)
    .values({
      eventKey: `payment-ledger:${source.eventKey}`,
      sourceKind: 'PAYMENT_LEDGER',
      paymentLedgerId: source.id,
      eventType: source.kind,
      cashDeltaMinor: source.kind === 'PAYMENT' ? source.amountMinor : -source.amountMinor,
      occurredAt: source.createdAt,
    })
    .onConflictDoNothing();
}

export async function projectCommissionEvent(
  tx: Tx,
  source: CommissionEvent,
  movement: CommissionMovement = {},
) {
  const mapped = commissionFinanceEventType[source.type as keyof typeof commissionFinanceEventType];
  if (!mapped) return;

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

  await tx
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
    .onConflictDoNothing();
}
