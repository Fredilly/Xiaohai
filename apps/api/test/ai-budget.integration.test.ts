import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
  consumerUsers,
  createDatabase,
} from '@xiaohai/db';
import {
  confirmAtRiskImageBudget,
  reserveImageBudget,
  recordImageBudgetOutcome,
} from '../src/ai/budget-service.js';

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

  it('confirms an at-risk charge once, releases the original reserve, and is idempotent', async () => {
    const consumerUserId = await user();
    const reservation = await db.transaction((tx) =>
      reserveImageBudget(tx, {
        ...budget,
        amountMinor: 22,
        idempotencyKey: 'manual-confirmation',
        resourceId: randomUUID(),
        consumerUserId,
        provider: 'BAILIAN',
        model: 'qwen-image-3.0',
      }),
    );
    await recordImageBudgetOutcome(
      db,
      reservation.id,
      'AT_RISK',
      null,
      undefined,
      'provider-request-1',
    );

    expect(await confirmAtRiskImageBudget(db, reservation.id, 18, 'provider-request-1')).toBe(true);
    expect(await confirmAtRiskImageBudget(db, reservation.id, 18, 'provider-request-1')).toBe(true);
    const [storedReservation] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.id, reservation.id));
    const ledgers = await db
      .select()
      .from(aiCostLedger)
      .where(eq(aiCostLedger.reservationId, reservation.id));
    const windows = await db.select().from(aiBudgetWindows);
    expect(storedReservation).toMatchObject({
      status: 'SETTLED',
      uncertainty: 'NONE',
      actualMinor: 18,
    });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({ amountMinor: 18, outcome: 'SUCCEEDED' });
    expect(windows.every((window) => window.reservedMinor === 0 && window.actualMinor === 18)).toBe(
      true,
    );
  });

  it('settles two consumers independently while sharing global actual spend', async () => {
    const [consumerA, consumerB] = await Promise.all([user(), user()]);
    const reservations = await Promise.all(
      [consumerA, consumerB].map((consumerUserId, index) =>
        db.transaction((tx) =>
          reserveImageBudget(tx, {
            ...budget,
            amountMinor: 100,
            idempotencyKey: `multi-consumer-${index}`,
            resourceId: randomUUID(),
            consumerUserId,
            provider: 'BAILIAN',
            model: 'qwen-image-3.0',
          }),
        ),
      ),
    );
    await Promise.all(
      reservations.map((reservation, index) =>
        recordImageBudgetOutcome(
          db,
          reservation.id,
          'AT_RISK',
          null,
          undefined,
          `provider-${index}`,
        ),
      ),
    );

    expect(await confirmAtRiskImageBudget(db, reservations[0]!.id, 80, 'provider-0')).toBe(true);
    const [consumerBWindowBefore] = await db
      .select()
      .from(aiBudgetWindows)
      .where(eq(aiBudgetWindows.consumerUserId, consumerB));
    expect(consumerBWindowBefore).toMatchObject({ reservedMinor: 100, actualMinor: 0 });
    expect(await confirmAtRiskImageBudget(db, reservations[1]!.id, 70, 'provider-1')).toBe(true);

    const windows = await db.select().from(aiBudgetWindows);
    const global = windows.find((window) => window.scopeType === 'GLOBAL');
    const consumerWindows = windows.filter((window) => window.scopeType === 'CONSUMER');
    expect(global).toMatchObject({ reservedMinor: 0, actualMinor: 150 });
    expect(consumerWindows.map((window) => window.actualMinor).sort()).toEqual([70, 80]);
    expect(consumerWindows.every((window) => window.reservedMinor === 0)).toBe(true);
  });

  it('rejects conflicting confirmation replays without changing settled state', async () => {
    const consumerUserId = await user();
    const reservation = await db.transaction((tx) =>
      reserveImageBudget(tx, {
        ...budget,
        amountMinor: 100,
        idempotencyKey: 'conflicting-replay',
        resourceId: randomUUID(),
        consumerUserId,
        provider: 'BAILIAN',
        model: 'qwen-image-3.0',
      }),
    );
    await recordImageBudgetOutcome(
      db,
      reservation.id,
      'AT_RISK',
      null,
      undefined,
      'provider-replay',
    );
    expect(await confirmAtRiskImageBudget(db, reservation.id, 80, 'provider-replay')).toBe(true);
    const before = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.id, reservation.id));
    const beforeLedger = await db
      .select()
      .from(aiCostLedger)
      .where(eq(aiCostLedger.reservationId, reservation.id));
    expect(await confirmAtRiskImageBudget(db, reservation.id, 81, 'provider-replay')).toBe(false);
    expect(await confirmAtRiskImageBudget(db, reservation.id, 80, 'provider-other')).toBe(false);
    expect(
      await db.select().from(aiCostReservations).where(eq(aiCostReservations.id, reservation.id)),
    ).toEqual(before);
    expect(
      await db.select().from(aiCostLedger).where(eq(aiCostLedger.reservationId, reservation.id)),
    ).toEqual(beforeLedger);
  });

  it('rolls back confirmation when a required window is missing or under-reserved', async () => {
    const consumerUserId = await user();
    const reservation = await db.transaction((tx) =>
      reserveImageBudget(tx, {
        ...budget,
        amountMinor: 100,
        idempotencyKey: 'window-integrity',
        resourceId: randomUUID(),
        consumerUserId,
        provider: 'BAILIAN',
        model: 'qwen-image-3.0',
      }),
    );
    await recordImageBudgetOutcome(
      db,
      reservation.id,
      'AT_RISK',
      null,
      undefined,
      'provider-window',
    );
    await db.delete(aiBudgetWindows).where(eq(aiBudgetWindows.consumerUserId, consumerUserId));
    expect(await confirmAtRiskImageBudget(db, reservation.id, 80, 'provider-window')).toBe(false);
    const [afterMissing] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.id, reservation.id));
    expect(afterMissing).toMatchObject({
      status: 'RESERVED',
      uncertainty: 'AT_RISK',
      actualMinor: null,
    });

    await db.insert(aiBudgetWindows).values({
      budgetKey: reservation.budgetKey,
      scopeType: 'CONSUMER',
      consumerUserId,
      windowKey: reservation.windowKey,
      limitMinor: 100,
      reservedMinor: 50,
    });
    expect(await confirmAtRiskImageBudget(db, reservation.id, 80, 'provider-window')).toBe(false);
    const [afterShort] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.id, reservation.id));
    const ledger = await db
      .select()
      .from(aiCostLedger)
      .where(eq(aiCostLedger.reservationId, reservation.id));
    expect(afterShort).toMatchObject({
      status: 'RESERVED',
      uncertainty: 'AT_RISK',
      actualMinor: null,
    });
    expect(ledger[0]).toMatchObject({ outcome: 'AT_RISK', amountMinor: 100 });
  });
});
