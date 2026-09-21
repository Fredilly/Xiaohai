import { z } from 'zod';

export const financeSourceKindSchema = z.enum(['PAYMENT_LEDGER', 'COMMISSION_EVENT']);
export const financeEventTypeSchema = z.enum([
  'PAYMENT',
  'REFUND',
  'COMMISSION_FROZEN',
  'COMMISSION_SETTLED',
  'COMMISSION_REVERSED',
  'WITHDRAWAL_HELD',
  'WITHDRAWAL_RELEASED',
  'WITHDRAWAL_PAID',
]);

const signedMinorSchema = z.number().int().safe();
const MAX_FINANCE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function validateRange(
  value: { from?: string; to?: string },
  ctx: z.RefinementCtx,
): void {
  if (!value.from || !value.to) return;
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (to <= from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    return;
  }
  if (to - from > MAX_FINANCE_RANGE_MS)
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'range must not exceed 366 days' });
}

export const financeLedgerEntrySchema = z
  .object({
    id: z.uuid(),
    eventKey: z.string().trim().min(1).max(200),
    sourceKind: financeSourceKindSchema,
    paymentLedgerId: z.uuid().nullable(),
    commissionEventId: z.uuid().nullable(),
    eventType: financeEventTypeSchema,
    currency: z.literal('CNY'),
    cashDeltaMinor: signedMinorSchema,
    commissionFrozenDeltaMinor: signedMinorSchema,
    commissionAvailableDeltaMinor: signedMinorSchema,
    occurredAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paymentSource = value.sourceKind === 'PAYMENT_LEDGER';
    if (paymentSource && (!value.paymentLedgerId || value.commissionEventId))
      ctx.addIssue({ code: 'custom', message: 'PAYMENT_LEDGER requires only paymentLedgerId' });
    if (!paymentSource && (!value.commissionEventId || value.paymentLedgerId))
      ctx.addIssue({ code: 'custom', message: 'COMMISSION_EVENT requires only commissionEventId' });
    if (
      value.cashDeltaMinor === 0 &&
      value.commissionFrozenDeltaMinor === 0 &&
      value.commissionAvailableDeltaMinor === 0
    )
      ctx.addIssue({ code: 'custom', message: 'Finance entry must contain a non-zero movement' });
  });

const financeRangeSchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .strict()
  .superRefine(validateRange);

export const financeSummaryQuerySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine(validateRange);

export const financeLedgerListQuerySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    sourceKind: financeSourceKindSchema.optional(),
    eventType: financeEventTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine(validateRange);

export const financeLedgerListResponseSchema = z
  .object({ items: z.array(financeLedgerEntrySchema) })
  .strict();

export const financeSummaryResponseSchema = z
  .object({
    cashInflowMinor: z.number().int().nonnegative(),
    cashOutflowMinor: z.number().int().nonnegative(),
    netCashMinor: signedMinorSchema,
    commissionFrozenDeltaMinor: signedMinorSchema,
    commissionAvailableDeltaMinor: signedMinorSchema,
    currency: z.literal('CNY'),
  })
  .strict();

export const createFinanceReconciliationRunRequestSchema = financeRangeSchema;
export const financeReconciliationOutcomeSchema = z.enum(['MATCHED', 'MISSING', 'MISMATCH']);
export const financeReconciliationStatusSchema = z.enum(['RUNNING', 'COMPLETED', 'FAILED']);

export const financeReconciliationItemSchema = z
  .object({
    id: z.uuid(),
    sourceKind: financeSourceKindSchema,
    sourceId: z.uuid(),
    eventKey: z.string().trim().min(1).max(200),
    eventType: financeEventTypeSchema,
    financeLedgerEntryId: z.uuid().nullable(),
    outcome: financeReconciliationOutcomeSchema,
    expectedCashDeltaMinor: signedMinorSchema,
    actualCashDeltaMinor: signedMinorSchema.nullable(),
    expectedCommissionFrozenDeltaMinor: signedMinorSchema,
    actualCommissionFrozenDeltaMinor: signedMinorSchema.nullable(),
    expectedCommissionAvailableDeltaMinor: signedMinorSchema,
    actualCommissionAvailableDeltaMinor: signedMinorSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const financeReconciliationRunSchema = z
  .object({
    id: z.uuid(),
    requestedByStaffAccountId: z.uuid(),
    rangeFrom: z.iso.datetime(),
    rangeTo: z.iso.datetime(),
    status: financeReconciliationStatusSchema,
    matchedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    mismatchCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    items: z.array(financeReconciliationItemSchema).optional(),
  })
  .strict();

export const financeExportRequestSchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    sourceKind: financeSourceKindSchema.optional(),
    eventType: financeEventTypeSchema.optional(),
  })
  .strict()
  .superRefine(validateRange);

export type FinanceSourceKind = z.infer<typeof financeSourceKindSchema>;
export type FinanceEventType = z.infer<typeof financeEventTypeSchema>;
export type FinanceLedgerEntry = z.infer<typeof financeLedgerEntrySchema>;
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;
export type FinanceLedgerListQuery = z.infer<typeof financeLedgerListQuerySchema>;
export type FinanceSummaryResponse = z.infer<typeof financeSummaryResponseSchema>;
export type CreateFinanceReconciliationRunRequest = z.infer<
  typeof createFinanceReconciliationRunRequestSchema
>;
export type FinanceReconciliationRun = z.infer<typeof financeReconciliationRunSchema>;
export type FinanceExportRequest = z.infer<typeof financeExportRequestSchema>;
