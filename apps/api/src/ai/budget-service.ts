import { and, eq, isNull } from 'drizzle-orm';
import {
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
type BudgetDb = Pick<Db, 'select' | 'insert' | 'update'>;

export type ImageBudgetConfig = {
  budgetKey: string;
  amountMinor: number;
  globalLimitMinor: number;
  consumerLimitMinor: number;
  windowKey: string;
};

export class AiBudgetError extends Error {
  constructor(readonly code: 'AI_COST_UNKNOWN' | 'AI_BUDGET_EXCEEDED') {
    super(code);
  }
}

export async function reserveImageBudget(
  tx: BudgetDb,
  input: ImageBudgetConfig & {
    idempotencyKey: string;
    consumerUserId: string;
    resourceId: string;
    provider: string;
    model: string;
  },
) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new AiBudgetError('AI_COST_UNKNOWN');
  }
  if (input.amountMinor > input.globalLimitMinor || input.amountMinor > input.consumerLimitMinor) {
    throw new AiBudgetError('AI_BUDGET_EXCEEDED');
  }

  const [existing] = await tx
    .select()
    .from(aiCostReservations)
    .where(eq(aiCostReservations.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) return existing;

  const windows: Array<typeof aiBudgetWindows.$inferSelect> = [];
  for (const scope of [
    { scopeType: 'GLOBAL' as const, consumerUserId: null, limitMinor: input.globalLimitMinor },
    {
      scopeType: 'CONSUMER' as const,
      consumerUserId: input.consumerUserId,
      limitMinor: input.consumerLimitMinor,
    },
  ]) {
    await tx
      .insert(aiBudgetWindows)
      .values({ ...scope, budgetKey: input.budgetKey, windowKey: input.windowKey })
      .onConflictDoNothing()
      .returning();
    const [locked] = await tx
      .select()
      .from(aiBudgetWindows)
      .where(
        and(
          eq(aiBudgetWindows.budgetKey, input.budgetKey),
          eq(aiBudgetWindows.scopeType, scope.scopeType),
          scope.consumerUserId
            ? eq(aiBudgetWindows.consumerUserId, scope.consumerUserId)
            : isNull(aiBudgetWindows.consumerUserId),
          eq(aiBudgetWindows.windowKey, input.windowKey),
        ),
      )
      .for('update');
    if (!locked) throw new AiBudgetError('AI_BUDGET_EXCEEDED');
    if (locked.reservedMinor + locked.actualMinor + input.amountMinor > locked.limitMinor) {
      throw new AiBudgetError('AI_BUDGET_EXCEEDED');
    }
    windows.push(locked);
  }

  const [reservation] = await tx
    .insert(aiCostReservations)
    .values({
      idempotencyKey: input.idempotencyKey,
      budgetKey: input.budgetKey,
      windowKey: input.windowKey,
      consumerUserId: input.consumerUserId,
      resourceType: 'PICTURE_BOOK_IMAGE',
      resourceId: input.resourceId,
      provider: input.provider,
      model: input.model,
      reservedMinor: input.amountMinor,
    })
    .returning();
  for (const window of windows) {
    await tx
      .update(aiBudgetWindows)
      .set({ reservedMinor: window.reservedMinor + input.amountMinor, updatedAt: new Date() })
      .where(eq(aiBudgetWindows.id, window.id));
  }
  return reservation!;
}

export async function recordImageBudgetOutcome(
  db: Db,
  reservationId: string,
  outcome: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED' | 'AT_RISK',
  actualMinor: number | null,
  failureCode?: string,
  providerRequestId?: string,
) {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.id, reservationId))
      .for('update');
    if (!reservation || reservation.status !== 'RESERVED') return false;
    const uncertain = outcome === 'AT_RISK' || actualMinor === null;
    await tx.insert(aiCostLedger).values({
      reservationId,
      consumerUserId: reservation.consumerUserId,
      resourceType: reservation.resourceType,
      resourceId: reservation.resourceId,
      provider: reservation.provider,
      model: reservation.model,
      amountMinor: actualMinor ?? reservation.reservedMinor,
      outcome,
      failureCode,
      providerRequestId,
    });
    await tx
      .update(aiCostReservations)
      .set({
        status: uncertain ? 'RESERVED' : 'SETTLED',
        uncertainty: uncertain ? 'AT_RISK' : 'NONE',
        actualMinor,
        failureCode,
        providerRequestId,
        settledAt: uncertain ? null : new Date(),
      })
      .where(eq(aiCostReservations.id, reservationId));
    if (!uncertain) {
      const windows = await tx
        .select()
        .from(aiBudgetWindows)
        .where(
          and(
            eq(aiBudgetWindows.budgetKey, reservation.budgetKey),
            eq(aiBudgetWindows.windowKey, reservation.windowKey),
          ),
        )
        .for('update');
      for (const window of windows) {
        await tx
          .update(aiBudgetWindows)
          .set({
            reservedMinor: Math.max(0, window.reservedMinor - reservation.reservedMinor),
            actualMinor: window.actualMinor + (actualMinor ?? reservation.reservedMinor),
            updatedAt: new Date(),
          })
          .where(eq(aiBudgetWindows.id, window.id));
      }
    }
    return true;
  });
}
