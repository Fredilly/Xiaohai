import { z } from 'zod';

export const rentalStatusSchema = z.enum([
  'RESERVED',
  'BORROWED',
  'OVERDUE',
  'RETURNED',
  'CANCELLED',
]);
export const rentalEventTypeSchema = rentalStatusSchema;
export const rentalLineInputSchema = z
  .object({ skuId: z.uuid(), quantity: z.number().int().min(1).max(99) })
  .strict();
export const createRentalRequestSchema = z
  .object({
    storeId: z.uuid(),
    items: z.array(rentalLineInputSchema).min(1).max(20),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.skuId)).size !== value.items.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate SKU' });
    }
  });

export const rentalActionRequestSchema = z.object({ idempotencyKey: z.uuid() }).strict();
export const rentalListQuerySchema = z
  .object({
    status: rentalStatusSchema.optional(),
    storeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const rentalItemSchema = z.object({
  id: z.uuid(),
  skuId: z.uuid(),
  skuCode: z.string(),
  skuName: z.string(),
  quantity: z.number().int().positive(),
});
export const rentalEventSchema = z.object({
  id: z.uuid(),
  eventType: rentalEventTypeSchema,
  actorType: z.enum(['CONSUMER', 'STAFF', 'SYSTEM']),
  createdAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()),
});
export const rentalViewSchema = z.object({
  id: z.uuid(),
  rentalNumber: z.string(),
  consumerUserId: z.uuid(),
  storeId: z.uuid(),
  storeName: z.string(),
  status: rentalStatusSchema,
  version: z.number().int().nonnegative(),
  reservedAt: z.coerce.date(),
  borrowedAt: z.coerce.date().nullable(),
  dueAt: z.coerce.date().nullable(),
  returnedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  isOverdue: z.boolean(),
  items: z.array(rentalItemSchema),
  events: z.array(rentalEventSchema),
});
export const rentalListResponseSchema = z.object({ items: z.array(rentalViewSchema) });

export type RentalStatus = z.infer<typeof rentalStatusSchema>;
export type CreateRentalRequest = z.infer<typeof createRentalRequestSchema>;
export type RentalActionRequest = z.infer<typeof rentalActionRequestSchema>;
export type RentalListQuery = z.infer<typeof rentalListQuerySchema>;
export type RentalView = z.infer<typeof rentalViewSchema>;
