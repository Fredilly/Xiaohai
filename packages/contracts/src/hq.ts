import { z } from 'zod';
import { moneyMinorSchema, orderItemSchema, orderStatusSchema } from './commerce.js';

const optionalIsoDate = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.iso.datetime().optional(),
);

export const hqOrderListQuerySchema = z
  .object({
    status: orderStatusSchema.optional(),
    consumerUserId: z.uuid().optional(),
    q: z.string().trim().min(1).max(120).optional(),
    createdFrom: optionalIsoDate,
    createdTo: optionalIsoDate,
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const hqOrderListItemSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  consumerUserId: z.uuid(),
  status: orderStatusSchema,
  subtotalMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const hqOrderListResponseSchema = z.object({ items: z.array(hqOrderListItemSchema) });

const safeAddressSnapshotSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  region: z.string(),
  city: z.string(),
  district: z.string(),
  addressLine: z.string(),
  postalCode: z.string().nullable(),
});

export const hqOrderDetailSchema = hqOrderListItemSchema.extend({
  address: safeAddressSnapshotSchema.nullable(),
  items: z.array(orderItemSchema),
  payment: z
    .object({
      id: z.uuid(),
      status: z.enum(['PENDING', 'SUCCEEDED', 'CLOSED']),
      amountMinor: moneyMinorSchema,
      currency: z.literal('CNY'),
      reviewRequired: z.boolean(),
    })
    .nullable(),
  fulfillment: z
    .object({
      method: z.enum(['PICKUP', 'DELIVERY']),
      storeId: z.uuid(),
      status: z.string(),
    })
    .nullable(),
  cancelledAt: z.iso.datetime().nullable(),
});

export const hqUserListQuerySchema = z
  .object({
    id: z.uuid().optional(),
    createdFrom: optionalIsoDate,
    createdTo: optionalIsoDate,
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const hqUserListItemSchema = z.object({
  id: z.uuid(),
  identityCount: z.number().int().nonnegative(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const hqUserListResponseSchema = z.object({ items: z.array(hqUserListItemSchema) });

export const hqUserDetailSchema = hqUserListItemSchema.extend({
  orderCount: z.number().int().nonnegative(),
  lifetimeOrderMinor: moneyMinorSchema,
  lastOrderAt: z.iso.datetime().nullable(),
});

export type HqOrderListQuery = z.infer<typeof hqOrderListQuerySchema>;
export type HqOrderListItem = z.infer<typeof hqOrderListItemSchema>;
export type HqOrderDetail = z.infer<typeof hqOrderDetailSchema>;
export type HqUserListQuery = z.infer<typeof hqUserListQuerySchema>;
export type HqUserListItem = z.infer<typeof hqUserListItemSchema>;
export type HqUserDetail = z.infer<typeof hqUserDetailSchema>;
