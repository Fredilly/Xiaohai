import { z } from 'zod';
import { moneyMinorSchema } from './commerce.js';
import { publicStoreSchema } from './stores.js';

export const inventoryAvailabilitySchema = z.enum(['ANY', 'SALE', 'RENT']);

const queryText = z.string().trim().min(1).max(120);
const optionalQueryText = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  queryText.optional(),
);
const optionalUuid = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.uuid().optional(),
);
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().pipe(schema).optional(),
  );

export const publicInventoryQuerySchema = z
  .object({
    q: optionalQueryText,
    availability: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      inventoryAvailabilitySchema.optional(),
    ),
    storeId: optionalUuid,
    regionId: optionalUuid,
    city: optionalQueryText,
    latitude: optionalNumber(z.number().min(-90).max(90)),
    longitude: optionalNumber(z.number().min(-180).max(180)),
    radiusKm: optionalNumber(z.number().positive().max(200)),
    limit: optionalNumber(z.number().int().min(1).max(100)),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: 'custom',
        message: 'latitude and longitude must be provided together',
      });
    }
    if (value.radiusKm !== undefined && (!hasLatitude || !hasLongitude)) {
      ctx.addIssue({ code: 'custom', message: 'radiusKm requires latitude and longitude' });
    }
  });

export const publicInventoryItemSchema = z.object({
  book: z.object({
    id: z.uuid(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().nullable(),
    publisher: z.string().nullable(),
  }),
  product: z.object({
    id: z.uuid(),
    name: z.string(),
    coverUrl: z.string().nullable(),
  }),
  sku: z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    priceMinor: moneyMinorSchema,
  }),
  store: publicStoreSchema,
  stock: z.object({
    onHand: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    rentalReserved: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  }),
  sellAvailable: z.boolean(),
  rentAvailable: z.boolean(),
});

export const publicInventorySearchResponseSchema = z.object({
  items: z.array(publicInventoryItemSchema),
});

export type InventoryAvailability = z.infer<typeof inventoryAvailabilitySchema>;
export type PublicInventoryQuery = z.infer<typeof publicInventoryQuerySchema>;
export type PublicInventoryItem = z.infer<typeof publicInventoryItemSchema>;

const shortText = z.string().trim().min(1).max(120);
const optionalText = z.string().trim().max(500).nullable().optional();
const positiveQuantity = z.number().int().positive().max(1_000_000);
const inventoryLineSchema = z.object({ skuId: z.uuid(), quantity: positiveQuantity }).strict();

export const supplierStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const supplierInputSchema = z
  .object({
    code: shortText,
    name: shortText,
    contactName: shortText.nullable().optional(),
    email: z.email().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
export const updateSupplierRequestSchema = supplierInputSchema
  .partial()
  .extend({ status: supplierStatusSchema.optional() })
  .strict();

export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
]);
export const createPurchaseOrderRequestSchema = z
  .object({
    supplierId: z.uuid(),
    storeId: z.uuid(),
    expectedAt: z.iso.datetime().nullable().optional(),
    notes: optionalText,
    items: z
      .array(
        inventoryLineSchema.extend({
          unitCostMinor: z.number().int().nonnegative().nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine(uniqueSkus);
export const purchaseOrderActionSchema = z
  .object({ action: z.enum(['SUBMIT', 'CANCEL']) })
  .strict();

export const createGoodsReceiptRequestSchema = z
  .object({
    purchaseOrderId: z.uuid(),
    notes: optionalText,
    items: z
      .array(z.object({ purchaseOrderItemId: z.uuid(), quantity: positiveQuantity }).strict())
      .min(1)
      .max(200),
  })
  .strict();

export const inventoryMutationRequestSchema = z
  .object({
    storeId: z.uuid(),
    skuId: z.uuid(),
    quantity: positiveQuantity,
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    reason: shortText,
  })
  .strict();
export const inventoryAdjustmentRequestSchema = inventoryMutationRequestSchema
  .omit({ quantity: true })
  .extend({
    quantityDelta: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((value) => value !== 0),
  })
  .strict();

export const createStocktakeRequestSchema = z
  .object({ storeId: z.uuid(), notes: optionalText, skuIds: z.array(z.uuid()).min(1).max(500) })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.skuIds).size !== value.skuIds.length)
      ctx.addIssue({ code: 'custom', path: ['skuIds'], message: 'Duplicate SKU' });
  });
export const stocktakeCountRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            skuId: z.uuid(),
            countedQuantity: z.number().int().nonnegative().max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine(uniqueSkus);
export const stocktakeActionSchema = z
  .object({ action: z.enum(['START', 'REVIEW', 'POST', 'CANCEL']) })
  .strict();

export const createStockTransferRequestSchema = z
  .object({
    sourceStoreId: z.uuid(),
    destinationStoreId: z.uuid(),
    notes: optionalText,
    items: z.array(inventoryLineSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    uniqueSkus(value, ctx);
    if (value.sourceStoreId === value.destinationStoreId)
      ctx.addIssue({ code: 'custom', path: ['destinationStoreId'], message: 'Stores must differ' });
  });
export const stockTransferActionSchema = z
  .object({ action: z.enum(['SUBMIT', 'DISPATCH', 'RECEIVE', 'CANCEL']) })
  .strict();

export const inventoryListQuerySchema = z
  .object({
    storeId: z.uuid().optional(),
    lowStockThreshold: z.coerce.number().int().nonnegative().max(10_000).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict();
export const inventoryBalanceSchema = z.object({
  storeId: z.uuid(),
  skuId: z.uuid(),
  skuCode: z.string(),
  skuName: z.string(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  rentalReserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
export const inventoryListResponseSchema = z.object({ items: z.array(inventoryBalanceSchema) });
export const inventoryTransactionSchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  skuId: z.uuid(),
  transactionType: z.string(),
  quantityDelta: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  referenceType: z.string(),
  referenceId: z.uuid(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;
export type CreateGoodsReceiptRequest = z.infer<typeof createGoodsReceiptRequestSchema>;
export type InventoryMutationRequest = z.infer<typeof inventoryMutationRequestSchema>;
export type InventoryAdjustmentRequest = z.infer<typeof inventoryAdjustmentRequestSchema>;
export type CreateStocktakeRequest = z.infer<typeof createStocktakeRequestSchema>;
export type StocktakeCountRequest = z.infer<typeof stocktakeCountRequestSchema>;
export type CreateStockTransferRequest = z.infer<typeof createStockTransferRequestSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

function uniqueSkus(value: { items: Array<{ skuId: string }> }, ctx: z.RefinementCtx) {
  if (new Set(value.items.map((item) => item.skuId)).size !== value.items.length)
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate SKU' });
}
