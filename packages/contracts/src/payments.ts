import { z } from 'zod';

export const createPaymentRequestSchema = z.object({ orderId: z.uuid() }).strict();
export const paymentParametersSchema = z
  .object({
    timeStamp: z.string().regex(/^\d+$/),
    nonceStr: z.string().min(1),
    package: z.string().startsWith('prepay_id='),
    signType: z.literal('RSA'),
    paySign: z.string().min(1),
  })
  .strict();
export const createPaymentResponseSchema = z
  .object({
    paymentId: z.uuid(),
    parameters: paymentParametersSchema,
  })
  .strict();
export const refundRequestSchema = z.object({ paymentId: z.uuid() }).strict();
export const refundResponseSchema = z
  .object({
    id: z.uuid(),
    paymentId: z.uuid(),
    status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'CLOSED', 'ABNORMAL']),
    amountMinor: z.number().int().positive(),
  })
  .strict();
export const paymentStatusSchema = z
  .object({
    id: z.uuid(),
    orderId: z.uuid(),
    status: z.enum(['PENDING', 'SUCCEEDED', 'CLOSED']),
    amountMinor: z.number().int().positive(),
    reviewRequired: z.boolean(),
  })
  .strict();
export type PaymentParameters = z.infer<typeof paymentParametersSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export const paymentListResponseSchema = z
  .object({ payments: z.array(paymentStatusSchema) })
  .strict();
export const reconciliationResponseSchema = z
  .object({ runId: z.uuid(), outcome: z.enum(['MATCHED', 'PENDING', 'REVIEW_REQUIRED', 'FAILED']) })
  .strict();
