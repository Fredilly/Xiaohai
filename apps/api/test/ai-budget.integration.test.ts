import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
  consumerUsers,
  createDatabase,
} from '@xiaohai/db';
import { reserveImageBudget, recordImageBudgetOutcome } from '../src/ai/budget-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('AI budget protection', () => {
  if (!database) return;
  const { db, pool } = database;
  const budget = {
    budgetKey: 'TEST_CUMULATIVE_500',
    amountMinor: 250,
    globalLimitMinor: 500,
    consumerLimitMinor: 500,
    windowKey: 'TEST_TOTAL',
  };

  async function user() {
    const [row] = await db.insert(consumerUsers).values({}).returning({ id: consumerUsers.id });
    if (!row) throw new Error('test user was not created');
    return row.id;
  }

  afterEach(async () => {
    await pool.query(
      'TRUNCATE TABLE ai_cost_ledger, ai_cost_reservations, ai_budget_windows, consumer_users CASCADE',
    );
  });
  afterAll(async () => database?.pool.end());

  it('reserves atomically, is idempotent, and settles known cost', async () => {
    const consumerUserId = await user();
    const resourceId = randomUUID();
    const input = {
      ...budget,
      idempotencyKey: 'same-request',
      consumerUserId,
      resourceId,
      provider: 'MOCK',
      model: 'mock-image',
    };
    const first = await db.transaction((tx) => reserveImageBudget(tx, input));
    const second = await db.transaction((tx) => reserveImageBudget(tx, input));
    expect(second.id).toBe(first.id);
    expect(await recordImageBudgetOutcome(db, first.id, 'SUCCEEDED', 100)).toBe(true);
    const [window] = await db.select().from(aiBudgetWindows);
    expect(window).toMatchObject({ reservedMinor: 0, actualMinor: 100 });
    const [ledger] = await db.select().from(aiCostLedger);
    expect(ledger).toMatchObject({ amountMinor: 100, outcome: 'SUCCEEDED' });
  });

  it('rejects the sixth 100-point request under the cumulative 500-point cap', async () => {
    const consumerUserId = await user();
    for (let i = 0; i < 5; i += 1) {
      const reservation = await db.transaction((tx) =>
        reserveImageBudget(tx, {
          ...budget,
          amountMinor: 100,
          idempotencyKey: `request-${i}`,
          resourceId: randomUUID(),
          consumerUserId,
          provider: 'MOCK',
          model: 'mock-image',
        }),
      );
      await recordImageBudgetOutcome(db, reservation.id, 'SUCCEEDED', 100);
    }
    await expect(
      db.transaction((tx) =>
        reserveImageBudget(tx, {
          ...budget,
          amountMinor: 100,
          idempotencyKey: 'request-6',
          resourceId: randomUUID(),
          consumerUserId,
          provider: 'MOCK',
          model: 'mock-image',
        }),
      ),
    ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });

  it('allows only one of two concurrent users to reserve the remaining global budget', async () => {
    const users = await Promise.all([user(), user()]);
    const results = await Promise.allSettled(
      users.map((consumerUserId, index) =>
        db.transaction((tx) =>
          reserveImageBudget(tx, {
            ...budget,
            amountMinor: 300,
            idempotencyKey: `concurrent-${index}`,
            resourceId: randomUUID(),
            consumerUserId,
            provider: 'BAILIAN',
            model: 'qwen-image-3.0',
          }),
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('holds an uncertain provider charge and blocks another reservation', async () => {
    const consumerUserId = await user();
    const reservation = await db.transaction((tx) =>
      reserveImageBudget(tx, {
        ...budget,
        amountMinor: 500,
        idempotencyKey: 'uncertain-request',
        resourceId: randomUUID(),
        consumerUserId,
        provider: 'BAILIAN',
        model: 'qwen-image-3.0',
      }),
    );
    await recordImageBudgetOutcome(db, reservation.id, 'AT_RISK', null, 'PROVIDER_OUTCOME_UNKNOWN');
    await expect(
      db.transaction((tx) =>
        reserveImageBudget(tx, {
          ...budget,
          idempotencyKey: 'after-uncertain',
          resourceId: randomUUID(),
          consumerUserId,
          provider: 'BAILIAN',
          model: 'qwen-image-3.0',
        }),
      ),
    ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    const [stored] = await db.select().from(aiCostReservations);
    expect(stored).toMatchObject({ status: 'RESERVED', uncertainty: 'AT_RISK' });
  });
});
