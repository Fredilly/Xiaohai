import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  commissionEvents,
  commissionLedger,
  consumerUsers,
  createDatabase,
  financeLedgerEntries,
  withdrawalRequests,
} from '@xiaohai/db';
import { backfillFinanceLedger } from '../src/finance/finance-ledger.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M21 finance historical backfill PostgreSQL integration', () => {
  const db = database!.db;
  const createdConsumerIds: string[] = [];
  const createdWithdrawalIds: string[] = [];
  const createdEventIds: string[] = [];

  async function cleanup() {
    if (createdEventIds.length > 0) {
      await db
        .delete(financeLedgerEntries)
        .where(inArray(financeLedgerEntries.commissionEventId, createdEventIds));
      await db.delete(commissionLedger).where(inArray(commissionLedger.eventId, createdEventIds));
      await db.delete(commissionEvents).where(inArray(commissionEvents.id, createdEventIds));
      createdEventIds.length = 0;
    }
    if (createdWithdrawalIds.length > 0) {
      await db
        .delete(withdrawalRequests)
        .where(inArray(withdrawalRequests.id, createdWithdrawalIds));
      createdWithdrawalIds.length = 0;
    }
    for (const id of createdConsumerIds.splice(0)) {
      await db.delete(consumerUsers).where(eq(consumerUsers.id, id));
    }
  }

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await database!.pool.end();
  });

  it('replays commission and withdrawal source movements once without recalculating them', async () => {
    const [consumer] = await db.insert(consumerUsers).values({}).returning();
    createdConsumerIds.push(consumer!.id);

    const [withdrawal] = await db
      .insert(withdrawalRequests)
      .values({
        consumerUserId: consumer!.id,
        amountMinor: 500,
        status: 'PAID',
        clientRequestId: `m21-backfill-${randomUUID()}`,
        paidAt: new Date(),
      })
      .returning();
    createdWithdrawalIds.push(withdrawal!.id);

    const [held] = await db
      .insert(commissionEvents)
      .values({
        eventKey: `m21-backfill-held-${randomUUID()}`,
        type: 'WITHDRAWAL_HELD',
        beneficiaryConsumerUserId: consumer!.id,
        withdrawalRequestId: withdrawal!.id,
        amountMinor: 500,
      })
      .returning();
    const [released] = await db
      .insert(commissionEvents)
      .values({
        eventKey: `m21-backfill-released-${randomUUID()}`,
        type: 'WITHDRAWAL_RELEASED',
        beneficiaryConsumerUserId: consumer!.id,
        withdrawalRequestId: withdrawal!.id,
        amountMinor: 500,
      })
      .returning();
    const [paid] = await db
      .insert(commissionEvents)
      .values({
        eventKey: `m21-backfill-paid-${randomUUID()}`,
        type: 'WITHDRAWAL_PAID',
        beneficiaryConsumerUserId: consumer!.id,
        withdrawalRequestId: withdrawal!.id,
        amountMinor: 500,
      })
      .returning();

    createdEventIds.push(held!.id, released!.id, paid!.id);

    await db.insert(commissionLedger).values([
      {
        eventId: held!.id,
        beneficiaryConsumerUserId: consumer!.id,
        availableDeltaMinor: -500,
      },
      {
        eventId: released!.id,
        beneficiaryConsumerUserId: consumer!.id,
        availableDeltaMinor: 500,
      },
    ]);

    const first = await backfillFinanceLedger(db, { sourceKind: 'COMMISSION_EVENT' });
    expect(first.commissionSources).toBeGreaterThanOrEqual(3);
    expect(first.insertedEntries).toBeGreaterThanOrEqual(3);

    const entries = await db
      .select()
      .from(financeLedgerEntries)
      .where(inArray(financeLedgerEntries.commissionEventId, createdEventIds));

    expect(entries).toHaveLength(3);
    expect(
      entries
        .map((entry) => ({
          eventType: entry.eventType,
          cash: entry.cashDeltaMinor,
          available: entry.commissionAvailableDeltaMinor,
        }))
        .sort((a, b) => a.eventType.localeCompare(b.eventType)),
    ).toEqual([
      { eventType: 'WITHDRAWAL_HELD', cash: 0, available: -500 },
      { eventType: 'WITHDRAWAL_PAID', cash: -500, available: 0 },
      { eventType: 'WITHDRAWAL_RELEASED', cash: 0, available: 500 },
    ]);

    const second = await backfillFinanceLedger(db, { sourceKind: 'COMMISSION_EVENT' });
    expect(second.insertedEntries).toBe(0);

    const repeated = await db
      .select()
      .from(financeLedgerEntries)
      .where(inArray(financeLedgerEntries.commissionEventId, createdEventIds));
    expect(repeated).toHaveLength(3);
  });
});
