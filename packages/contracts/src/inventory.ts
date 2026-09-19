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
const timestampSchema = z.iso.datetime();

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
export const supplierSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: supplierStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const supplierListResponseSchema = z.object({ suppliers: z.array(supplierSchema) });

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
export const purchaseOrderItemSchema = z.object({
  id: z.uuid(),
  purchaseOrderId: z.uuid(),
  skuId: z.uuid(),
  orderedQuantity: z.number().int().positive(),
  receivedQuantity: z.number().int().nonnegative(),
  unitCostMinor: z.number().int().nonnegative().nullable(),
});
export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  supplierId: z.uuid(),
  storeId: z.uuid(),
  status: purchaseOrderStatusSchema,
  notes: z.string().nullable(),
  expectedAt: timestampSchema.nullable(),
  createdByStaffAccountId: z.uuid(),
  submittedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const purchaseOrderViewSchema = purchaseOrderSchema.extend({
  items: z.array(purchaseOrderItemSchema),
});

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
export const goodsReceiptItemSchema = z.object({
  id: z.uuid(),
  goodsReceiptId: z.uuid(),
  purchaseOrderItemId: z.uuid(),
  skuId: z.uuid(),
  quantity: z.number().int().positive(),
});
export const goodsReceiptSchema = z.object({
  id: z.uuid(),
  receiptNumber: z.string(),
  purchaseOrderId: z.uuid(),
  storeId: z.uuid(),
  status: z.enum(['DRAFT', 'POSTED']),
  notes: z.string().nullable(),
  createdByStaffAccountId: z.uuid(),
  postedByStaffAccountId: z.uuid().nullable(),
  postedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const goodsReceiptViewSchema = goodsReceiptSchema.extend({ items: z.array(goodsReceiptItemSchema) });

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
export const stocktakeItemSchema = z.object({
  id: z.uuid(),
  stocktakeId: z.uuid(),
  skuId: z.uuid(),
  expectedQuantity: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative(),
  countedQuantity: z.number().int().nonnegative().nullable(),
});
export const stocktakeSchema = z.object({
  id: z.uuid(),
  stocktakeNumber: z.string(),
  storeId: z.uuid(),
  status: z.enum(['DRAFT', 'COUNTING', 'REVIEWED', 'POSTED', 'CANCELLED']),
  notes: z.string().nullable(),
  createdByStaffAccountId: z.uuid(),
  reviewedByStaffAccountId: z.uuid().nullable(),
  postedByStaffAccountId: z.uuid().nullable(),
  reviewedAt: timestampSchema.nullable(),
  postedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const stocktakeViewSchema = stocktakeSchema.extend({ items: z.array(stocktakeItemSchema) });

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
export const stockTransferItemSchema = z.object({
  id: z.uuid(),
  stockTransferId: z.uuid(),
  skuId: z.uuid(),
  quantity: z.number().int().positive(),
});
export const stockTransferSchema = z.object({
  id: z.uuid(),
  transferNumber: z.string(),
  sourceStoreId: z.uuid(),
  destinationStoreId: z.uuid(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']),
  notes: z.string().nullable(),
  createdByStaffAccountId: z.uuid(),
  submittedAt: timestampSchema.nullable(),
  dispatchedAt: timestampSchema.nullable(),
  receivedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export const stockTransferViewSchema = stockTransferSchema.extend({ items: z.array(stockTransferItemSchema) });

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
  createdAt: timestampSchema,
});
export const inventoryTransactionsResponseSchema = z.object({
  transactions: z.array(inventoryTransactionSchema),
});
export const inventoryAlertSchema = inventoryBalanceSchema.extend({
  severity: z.enum(['OUT_OF_STOCK', 'LOW_STOCK']),
});
export const inventoryAlertsResponseSchema = z.object({ alerts: z.array(inventoryAlertSchema) });

export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;
export type CreateGoodsReceiptRequest = z.infer<typeof createGoodsReceiptRequestSchema>;
export type InventoryMutationRequest = z.infer<typeof inventoryMutationRequestSchema>;
export type InventoryAdjustmentRequest = z.infer<typeof inventoryAdjustmentRequestSchema>;
export type CreateStocktakeRequest = z.infer<typeof createStocktakeRequestSchema>;
export type StocktakeCountRequest = z.infer<typeof stocktakeCountRequestSchema>;
export type CreateStockTransferRequest = z.infer<typeof createStockTransferRequestSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderViewSchema>;
export type GoodsReceipt = z.infer<typeof goodsReceiptViewSchema>;
export type Stocktake = z.infer<typeof stocktakeViewSchema>;
export type StockTransfer = z.infer<typeof stockTransferViewSchema>;

function uniqueSkus(value: { items: Array<{ skuId: string }> }, ctx: z.RefinementCtx) {
  if (new Set(value.items.map((item) => item.skuId)).size !== value.items.length)
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate SKU' });
}
