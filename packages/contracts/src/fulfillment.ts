import { z } from 'zod';
import { moneyMinorSchema } from './commerce.js';

export const fulfillmentMethodSchema = z.enum(['PICKUP', 'DELIVERY']);
export const pickupCodeSchema = z.string().regex(/^\d{6}$/);
export const pickupCodeStatusSchema = z.enum(['ISSUED', 'VERIFIED', 'CANCELLED']);
export const deliveryStatusSchema = z.enum(['PENDING', 'DISPATCHED', 'DELIVERED', 'CANCELLED']);

export const fulfillmentQuoteRequestSchema = z
  .object({
    method: fulfillmentMethodSchema,
    storeId: z.uuid(),
    addressId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'DELIVERY' && !value.addressId) {
      ctx.addIssue({
        code: 'custom',
        path: ['addressId'],
        message: 'Delivery requires addressId',
      });
    }
  });

export const fulfilledOrderRequestSchema = fulfillmentQuoteRequestSchema
  .safeExtend({
    clientRequestId: z.string().trim().min(8).max(128),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{8,32}$/)
      .optional(),
  })
  .strict();

export const fulfilledOrderResponseSchema = z.object({ orderId: z.uuid() });

export const fulfillmentQuoteSchema = z.object({
  method: fulfillmentMethodSchema,
  store: z.object({ id: z.uuid(), name: z.string() }),
  subtotalMinor: moneyMinorSchema,
  deliveryFeeMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  deliveryZone: z
    .object({
      id: z.uuid(),
      name: z.string(),
      providerKey: z.string(),
    })
    .nullable(),
});

export const fulfillmentViewSchema = z.object({
  orderId: z.uuid(),
  method: fulfillmentMethodSchema,
  store: z.object({ id: z.uuid(), name: z.string() }),
  deliveryFeeMinor: moneyMinorSchema,
  pickup: z
    .object({
      status: pickupCodeStatusSchema,
      code: pickupCodeSchema.nullable(),
      issuedAt: z.coerce.date(),
      verifiedAt: z.coerce.date().nullable(),
    })
    .nullable(),
  delivery: z
    .object({
      id: z.uuid(),
      status: deliveryStatusSchema,
      providerKey: z.string(),
      providerOrderId: z.string().nullable(),
      zoneName: z.string(),
      dispatchedAt: z.coerce.date().nullable(),
      deliveredAt: z.coerce.date().nullable(),
    })
    .nullable(),
});

export const deliveryZoneInputSchema = z
  .object({
    storeId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(80).nullable().optional(),
    feeMinor: moneyMinorSchema,
    providerKey: z.string().trim().min(1).max(64).default('MANUAL'),
    active: z.boolean().default(true),
  })
  .strict();

export const deliveryZoneSchema = deliveryZoneInputSchema.extend({
  id: z.uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const deliveryZoneListResponseSchema = z.object({ items: z.array(deliveryZoneSchema) });

export const deliveryZoneListQuerySchema = z
  .object({
    storeId: z.uuid().optional(),
    active: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const fulfillmentStaffListQuerySchema = z
  .object({
    storeId: z.uuid().optional(),
    method: fulfillmentMethodSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const fulfillmentStaffItemSchema = fulfillmentViewSchema.extend({
  orderNumber: z.string(),
  orderStatus: z.string(),
  consumerUserId: z.uuid(),
  totalMinor: moneyMinorSchema,
  createdAt: z.coerce.date(),
});

export const fulfillmentStaffListResponseSchema = z.object({
  items: z.array(fulfillmentStaffItemSchema),
});

export const fulfillmentActionRequestSchema = z.object({ idempotencyKey: z.uuid() }).strict();

export const pickupVerifyRequestSchema = fulfillmentActionRequestSchema
  .safeExtend({ pickupCode: pickupCodeSchema })
  .strict();

export type FulfillmentMethod = z.infer<typeof fulfillmentMethodSchema>;
export type FulfillmentQuoteRequest = z.infer<typeof fulfillmentQuoteRequestSchema>;
export type FulfilledOrderRequest = z.infer<typeof fulfilledOrderRequestSchema>;
export type FulfillmentQuote = z.infer<typeof fulfillmentQuoteSchema>;
export type FulfillmentView = z.infer<typeof fulfillmentViewSchema>;
export type DeliveryZoneInput = z.infer<typeof deliveryZoneInputSchema>;
export type DeliveryZoneListQuery = z.infer<typeof deliveryZoneListQuerySchema>;
export type FulfillmentStaffListQuery = z.infer<typeof fulfillmentStaffListQuerySchema>;
