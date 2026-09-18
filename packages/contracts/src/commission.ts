import { z } from 'zod';

export const referralCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{8,32}$/);
export const createReferralLinkRequestSchema = z
  .object({ label: z.string().trim().min(1).max(80).optional() })
  .strict();
export const referralLinkSchema = z.object({
  id: z.uuid(),
  code: referralCodeSchema,
  label: z.string().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  sharePath: z.string(),
  createdAt: z.iso.datetime(),
});
export const referralLinkListResponseSchema = z.object({ links: z.array(referralLinkSchema) });

export const createCommissionRuleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    rateBasisPoints: z.number().int().min(0).max(10000),
    freezeDays: z.number().int().min(0).max(365),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable().optional(),
  })
  .strict();
export const updateCommissionRuleStatusRequestSchema = z
  .object({ status: z.enum(['ACTIVE', 'INACTIVE']), version: z.number().int().positive() })
  .strict();
export const commissionRuleSchema = createCommissionRuleRequestSchema.extend({
  id: z.uuid(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']),
  basis: z.literal('ORDER_TOTAL'),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const commissionEventTypeSchema = z.enum([
  'FROZEN',
  'SETTLED',
  'REVERSED',
  'WITHDRAWAL_HELD',
  'WITHDRAWAL_RELEASED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_PAID',
]);
export const commissionLedgerEntrySchema = z.object({
  id: z.uuid(),
  eventType: commissionEventTypeSchema,
  amountMinor: z.number().int().positive(),
  frozenDeltaMinor: z.number().int(),
  availableDeltaMinor: z.number().int(),
  createdAt: z.iso.datetime(),
});
export const commissionAccountSchema = z.object({
  frozenMinor: z.number().int(),
  availableMinor: z.number().int(),
  entries: z.array(commissionLedgerEntrySchema),
});

export const createWithdrawalRequestSchema = z
  .object({
    amountMinor: z.number().int().positive().max(2147483647),
    clientRequestId: z.string().trim().min(8).max(128),
  })
  .strict();
export const reviewWithdrawalRequestSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'MARK_PAID']),
    version: z.number().int().positive(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export const withdrawalSchema = z.object({
  id: z.uuid(),
  amountMinor: z.number().int().positive(),
  status: z.enum(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED']),
  clientRequestId: z.string(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});
export const withdrawalListResponseSchema = z.object({ withdrawals: z.array(withdrawalSchema) });
export const staffCommissionOverviewSchema = z.object({
  rules: z.array(commissionRuleSchema),
  earnings: z.array(
    z.object({
      id: z.uuid(),
      beneficiaryConsumerUserId: z.uuid(),
      amountMinor: z.number().int().positive(),
      frozenUntil: z.iso.datetime(),
      state: z.enum(['FROZEN', 'SETTLED', 'REVERSED']),
      createdAt: z.iso.datetime(),
    }),
  ),
  withdrawals: z.array(withdrawalSchema.extend({ consumerUserId: z.uuid() })),
});

export type CreateCommissionRuleRequest = z.infer<typeof createCommissionRuleRequestSchema>;
export type ReviewWithdrawalRequest = z.infer<typeof reviewWithdrawalRequestSchema>;
export type ReferralLink = z.infer<typeof referralLinkSchema>;
export type CommissionAccount = z.infer<typeof commissionAccountSchema>;
export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export type Withdrawal = z.infer<typeof withdrawalSchema>;
export type StaffCommissionOverview = z.infer<typeof staffCommissionOverviewSchema>;
