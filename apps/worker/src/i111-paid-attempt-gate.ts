import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
  pictureBooks,
  workPageIllustrations,
  workPages,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];

/**
 * This is an exact, single-purpose DEV gate for the original Mac Plan B fixture.
 * It is not a general provider-budget feature and cannot authorize a paid run.
 * A one-shot runner, code review and separate owner operation approval remain mandatory.
 */
export const I111_PAID_RUN = Object.freeze({
  bookId: '90d7f77e-ae23-40ef-90b6-a672412c6318',
  ownerId: '11111111-1111-4111-8111-111111111111',
  page1Id: '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb',
  page2Id: 'eae00ed5-6026-4a41-b95a-6c9eea09d076',
  budgetKey: 'I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS',
  windowKey: 'I111_20261117_ISOLATED_BOOK_ONLY',
  model: 'qwen-image-3.0',
  reservationMinor: 25,
  totalLimitMinor: 200,
  maxCalls: 3,
});

export type I111PaidRunScope = typeof I111_PAID_RUN;
export type I111AllowedIllustration = {
  id: string;
  pageId: string;
  revisionNumber: number;
  provider: string;
  model: string;
};

export class I111AttemptStop extends Error {
  constructor(readonly code: string = 'I111_PAID_ATTEMPT_STOP') {
    super(code);
  }
}

const SLOT_MARKER = 'I111_PROVIDER_SLOT_CONSUMED';
export const I111_PROVIDER_SLOT_MARKER = SLOT_MARKER;

export function i111AllowedSlots(scope: I111PaidRunScope) {
  return [
    { pageId: scope.page1Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 2 },
  ] as const;
}

export function assertI111Slot(
  scope: I111PaidRunScope,
  consumed: number,
  illustration: I111AllowedIllustration,
): number {
  if (
    !Number.isInteger(consumed) ||
    consumed < 0 ||
    consumed >= scope.maxCalls ||
    scope.maxCalls !== 3 ||
    illustration.provider !== 'BAILIAN' ||
    illustration.model !== scope.model
  ) {
    throw new I111AttemptStop();
  }
  const next = i111AllowedSlots(scope)[consumed];
  if (
    !next ||
    illustration.pageId !== next.pageId ||
    illustration.revisionNumber !== next.revisionNumber
  ) {
    throw new I111AttemptStop();
  }
  return consumed + 1;
}

/**
 * A reservation is created in the API transaction BEFORE any provider work.
 * This function irrevocably consumes one of three slots in the SAME DB before
 * entering provider.generate. It holds the GLOBAL budget-window row lock to
 * serialize two competing one-shot processes. A crash after commit consumes
 * its slot; neither timeout nor failed/unknown POST may release/reuse it.
 *
 * The single existing ai_cost_ledger row becomes the durable attempt marker.
 * Later manual AT_RISK confirmation changes only its outcome/amount, preserving
 * the marker in failure_code; no new schema or migration is necessary.
 */
export async function consumeI111ProviderSlot(
  db: Db,
  illustrationId: string,
  scope: I111PaidRunScope = I111_PAID_RUN,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [globalWindow] = await tx
      .select()
      .from(aiBudgetWindows)
      .where(
        and(
          eq(aiBudgetWindows.budgetKey, scope.budgetKey),
          eq(aiBudgetWindows.windowKey, scope.windowKey),
          eq(aiBudgetWindows.scopeType, 'GLOBAL'),
          isNull(aiBudgetWindows.consumerUserId),
        ),
      )
      .for('update');
    if (!globalWindow || globalWindow.limitMinor !== scope.totalLimitMinor) {
      throw new I111AttemptStop();
    }

    const [consumerWindow] = await tx
      .select()
      .from(aiBudgetWindows)
      .where(
        and(
          eq(aiBudgetWindows.budgetKey, scope.budgetKey),
          eq(aiBudgetWindows.windowKey, scope.windowKey),
          eq(aiBudgetWindows.scopeType, 'CONSUMER'),
          eq(aiBudgetWindows.consumerUserId, scope.ownerId),
        ),
      )
      .for('update');
    if (!consumerWindow || consumerWindow.limitMinor !== scope.totalLimitMinor) {
      throw new I111AttemptStop();
    }
    if (
      globalWindow.actualMinor + globalWindow.reservedMinor > scope.totalLimitMinor ||
      consumerWindow.actualMinor + consumerWindow.reservedMinor > scope.totalLimitMinor
    ) {
      throw new I111AttemptStop();
    }

    const records = await tx
      .select({
        reservation: aiCostReservations,
        illustration: workPageIllustrations,
        page: workPages,
        book: pictureBooks,
      })
      .from(aiCostReservations)
      .leftJoin(
        workPageIllustrations,
        eq(workPageIllustrations.id, aiCostReservations.resourceId),
      )
      .leftJoin(workPages, eq(workPages.id, workPageIllustrations.pageId))
      .leftJoin(pictureBooks, eq(pictureBooks.id, workPages.pictureBookId))
      .where(
        and(
          eq(aiCostReservations.budgetKey, scope.budgetKey),
          eq(aiCostReservations.windowKey, scope.windowKey),
        ),
      );

    if (records.length < 1 || records.length > scope.maxCalls) {
      throw new I111AttemptStop();
    }
    const reservationIds = records.map((record) => record.reservation.id);
    if (new Set(reservationIds).size !== records.length) throw new I111AttemptStop();
    const ledgers = await tx
      .select()
      .from(aiCostLedger)
      .where(inArray(aiCostLedger.reservationId, reservationIds));
    if (
      ledgers.length > scope.maxCalls ||
      ledgers.some((entry) => entry.failureCode !== SLOT_MARKER)
    ) {
      throw new I111AttemptStop();
    }
    const byReservation = new Map<string, (typeof ledgers)[number]>();
    for (const entry of ledgers) {
      if (byReservation.has(entry.reservationId)) throw new I111AttemptStop();
      byReservation.set(entry.reservationId, entry);
    }

    const consumed = byReservation.size;
    const [current] = records.filter((record) => record.reservation.resourceId === illustrationId);
    if (!current || records.filter((record) => record.reservation.resourceId === illustrationId).length !== 1) {
      throw new I111AttemptStop();
    }
    if (records.length !== consumed + 1 || byReservation.has(current.reservation.id)) {
      throw new I111AttemptStop();
    }

    const plan = i111AllowedSlots(scope);
    for (const record of records) {
      const { reservation, illustration, page, book } = record;
      if (
        !illustration ||
        !page ||
        !book ||
        book.id !== scope.bookId ||
        book.consumerUserId !== scope.ownerId ||
        page.pictureBookId !== scope.bookId ||
        page.pageKind !== 'CONTENT' ||
        reservation.consumerUserId !== scope.ownerId ||
        reservation.resourceType !== 'PICTURE_BOOK_IMAGE' ||
        reservation.provider !== 'BAILIAN' ||
        reservation.model !== scope.model ||
        illustration.provider !== 'BAILIAN' ||
        illustration.model !== scope.model ||
        reservation.reservedMinor !== scope.reservationMinor
      ) {
        throw new I111AttemptStop();
      }
      const position = plan.findIndex(
        (expected) =>
          illustration.pageId === expected.pageId &&
          illustration.revisionNumber === expected.revisionNumber,
      );
      if (position < 0) throw new I111AttemptStop();
      const marker = byReservation.get(reservation.id);
      if (marker) {
        if (
          position >= consumed ||
          reservation.status !== 'SETTLED' ||
          reservation.uncertainty !== 'NONE' ||
          !reservation.providerRequestId ||
          reservation.actualMinor === null ||
          reservation.actualMinor > reservation.reservedMinor ||
          illustration.status !== 'READY' ||
          !illustration.mediaAssetId ||
          marker.outcome !== 'SUCCEEDED' ||
          marker.providerRequestId !== reservation.providerRequestId
        ) {
          throw new I111AttemptStop();
        }
      } else if (
        record !== current ||
        position !== consumed ||
        reservation.status !== 'RESERVED' ||
        reservation.uncertainty !== 'NONE' ||
        illustration.status !== 'RUNNING'
      ) {
        throw new I111AttemptStop();
      }
    }
    // A lost/replaced prior reservation must not allow a later slot.
    for (let i = 0; i < consumed; i += 1) {
      const expected = plan[i]!;
      if (
        records.filter(
          (record) =>
            record.illustration?.pageId === expected.pageId &&
            record.illustration.revisionNumber === expected.revisionNumber &&
            byReservation.has(record.reservation.id),
        ).length !== 1
      ) {
        throw new I111AttemptStop();
      }
    }
    assertI111Slot(scope, consumed, {
      id: current.illustration!.id,
      pageId: current.illustration!.pageId,
      revisionNumber: current.illustration!.revisionNumber,
      provider: current.illustration!.provider,
      model: current.illustration!.model,
    });

    // Concurrency-safe durable consume, committed BEFORE the external POST.
    await tx.insert(aiCostLedger).values({
      reservationId: current.reservation.id,
      consumerUserId: scope.ownerId,
      resourceType: 'PICTURE_BOOK_IMAGE',
      resourceId: current.reservation.resourceId,
      provider: 'BAILIAN',
      model: scope.model,
      amountMinor: current.reservation.reservedMinor,
      outcome: 'AT_RISK',
      failureCode: SLOT_MARKER,
    });
    const updated = await tx
      .update(aiCostReservations)
      .set({ uncertainty: 'AT_RISK' })
      .where(
        and(
          eq(aiCostReservations.id, current.reservation.id),
          eq(aiCostReservations.status, 'RESERVED'),
          eq(aiCostReservations.uncertainty, 'NONE'),
        ),
      )
      .returning({ id: aiCostReservations.id });
    if (updated.length !== 1) throw new I111AttemptStop();
    return consumed + 1;
  });
}

/** Attach safe provider metadata to the consumed marker; NEVER settle costs here. */
export async function noteI111ProviderOutcome(
  db: Db,
  resourceId: string,
  providerRequestId?: string,
  errorCode?: string,
  scope: I111PaidRunScope = I111_PAID_RUN,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(aiCostReservations)
      .where(
        and(
          eq(aiCostReservations.resourceId, resourceId),
          eq(aiCostReservations.budgetKey, scope.budgetKey),
          eq(aiCostReservations.windowKey, scope.windowKey),
        ),
      )
      .for('update');
    if (
      !reservation ||
      reservation.uncertainty !== 'AT_RISK' ||
      reservation.status !== 'RESERVED' ||
      (reservation.providerRequestId &&
        providerRequestId &&
        reservation.providerRequestId !== providerRequestId)
    ) {
      throw new I111AttemptStop();
    }
    const rows = await tx
      .select()
      .from(aiCostLedger)
      .where(eq(aiCostLedger.reservationId, reservation.id))
      .for('update');
    if (
      rows.length !== 1 ||
      rows[0]!.failureCode !== SLOT_MARKER ||
      rows[0]!.outcome !== 'AT_RISK'
    ) {
      throw new I111AttemptStop();
    }
    const requestId = reservation.providerRequestId ?? providerRequestId ?? null;
    await tx
      .update(aiCostReservations)
      .set({ providerRequestId: requestId, failureCode: errorCode ?? null })
      .where(eq(aiCostReservations.id, reservation.id));
    await tx
      .update(aiCostLedger)
      .set({ providerRequestId: requestId })
      .where(eq(aiCostLedger.id, rows[0]!.id));
  });
}
