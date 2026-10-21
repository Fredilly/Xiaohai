import { z } from 'zod';

export const moneyMinorSchema = z.number().int().min(0).max(2147483647);
export const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']);
export const skuStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const orderStatusSchema = z.enum([
  'UNPAID',
  'PAID',
  'PROCESSING',
  'PICKUP_READY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDING',
  'REFUNDED',
]);
export const commerceErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'CONSUMER_AUTHENTICATION_REQUIRED',
  'STAFF_AUTHENTICATION_REQUIRED',
  'STAFF_FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'NOT_PURCHASABLE',
  'INVALID_ORDER_STATE',
  'INTERNAL_ERROR',
]);
export const commerceErrorResponseSchema = z.object({
  error: z.object({ code: commerceErrorCodeSchema, message: z.string(), requestId: z.string() }),
});
export const catalogQuerySchema = z.object({ q: z.string().trim().max(120).optional() }).strict();
export const catalogSkuSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  priceMinor: moneyMinorSchema,
  availableForSale: z.boolean(),
});
export const catalogProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  isbn: z.string().nullable(),
  publisher: z.string().nullable(),
  skus: z.array(catalogSkuSchema),
});
export const catalogListResponseSchema = z.object({ products: z.array(catalogProductSchema) });
export const cartItemSchema = z.object({
  id: z.uuid(),
  skuId: z.uuid(),
  productName: z.string(),
  skuName: z.string(),
  unitPriceMinor: moneyMinorSchema,
  quantity: z.number().int().min(1).max(99),
  lineTotalMinor: moneyMinorSchema,
  availableForSale: z.boolean(),
});
export const cartResponseSchema = z.object({
  items: z.array(cartItemSchema),
  subtotalMinor: moneyMinorSchema,
});
export const addCartItemRequestSchema = z
  .object({ skuId: z.uuid(), quantity: z.number().int().min(1).max(99) })
  .strict();
export const updateCartItemRequestSchema = z
  .object({ quantity: z.number().int().min(1).max(99) })
  .strict();
export const addressInputSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(5).max(32),
    region: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(80),
    district: z.string().trim().min(1).max(80),
    addressLine: z.string().trim().min(1).max(240),
    postalCode: z.string().trim().max(24).nullable().optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();
export const addressSchema = addressInputSchema.extend({ id: z.uuid() });
export const addressListResponseSchema = z.object({ addresses: z.array(addressSchema) });
export const checkoutPreviewRequestSchema = z.object({ addressId: z.uuid() }).strict();
export const checkoutPreviewResponseSchema = z.object({
  cart: cartResponseSchema,
  address: addressSchema,
  subtotalMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  paymentAvailable: z.literal(false),
  paymentMessage: z.string(),
});
export const createOrderRequestSchema = z
  .object({
    addressId: z.uuid(),
    clientRequestId: z.string().trim().min(8).max(128),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{8,32}$/)
      .optional(),
  })
  .strict();
export const orderItemSchema = z.object({
  id: z.uuid(),
  productName: z.string(),
  skuName: z.string(),
  skuCode: z.string(),
  unitPriceMinor: moneyMinorSchema,
  quantity: z.number().int().min(1).max(99),
  lineTotalMinor: moneyMinorSchema,
});
export const orderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  subtotalMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  address: addressInputSchema.omit({ isDefault: true }).nullable(),
  items: z.array(orderItemSchema),
  createdAt: z.iso.datetime(),
});
export const orderListResponseSchema = z.object({ orders: z.array(orderSchema) });
export const adminCatalogQuerySchema = z
  .object({ q: z.string().trim().max(120).optional(), status: productStatusSchema.optional() })
  .strict();
export const adminProductInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000).nullable().optional(),
    coverUrl: z.url().max(2048).nullable().optional(),
    status: productStatusSchema,
    book: z
      .object({
        title: z.string().trim().min(1).max(200),
        author: z.string().trim().min(1).max(160),
        isbn: z.string().trim().max(32).nullable().optional(),
        publisher: z.string().trim().max(160).nullable().optional(),
      })
      .nullable()
      .optional(),
    sku: z.object({
      code: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(120),
      priceMinor: moneyMinorSchema,
      status: skuStatusSchema,
      availableForSale: z.boolean(),
    }),
  })
  .strict();
export const adminProductSchema = adminProductInputSchema.extend({ id: z.uuid(), skuId: z.uuid() });
export const adminProductListResponseSchema = z.object({ products: z.array(adminProductSchema) });

export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CartResponse = z.infer<typeof cartResponseSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Order = z.infer<typeof orderSchema>;
export type AdminProductInput = z.infer<typeof adminProductInputSchema>;
export type CommerceErrorCode = z.infer<typeof commerceErrorCodeSchema>;

/** Authenticated Staff read-model: only SKU rows linked to the scoped store's inventory. */
export const storeCatalogQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const storeCatalogItemSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  productStatus: productStatusSchema,
  coverUrl: z.string().nullable(),
  bookTitle: z.string().nullable(),
  author: z.string().nullable(),
  isbn: z.string().nullable(),
  publisher: z.string().nullable(),
  skuId: z.uuid(),
  skuCode: z.string(),
  skuName: z.string(),
  skuStatus: skuStatusSchema,
  priceMinor: moneyMinorSchema,
  availableForSale: z.boolean(),
  onHand: z.number().int().min(0),
  reserved: z.number().int().min(0),
  rentalReserved: z.number().int().min(0),
  available: z.number().int().min(0),
  inventoryVersion: z.number().int().min(0),
});
export const storeCatalogResponseSchema = z.object({
  storeId: z.uuid(),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  hasMore: z.boolean(),
  items: z.array(storeCatalogItemSchema),
});
export type StoreCatalogItem = z.infer<typeof storeCatalogItemSchema>;
export type StoreCatalogResponse = z.infer<typeof storeCatalogResponseSchema>;

/** Ordinary daily catalog correction requests never write shared master data. */
export const catalogCorrectionFieldSchema = z.enum([
  'productName',
  'bookTitle',
  'author',
  'publisher',
  'isbn',
  'priceMinor',
]);
export const catalogCorrectionStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export const createCatalogCorrectionSchema = z
  .object({
    skuId: z.uuid(),
    expectedInventoryVersion: z.number().int().nonnegative(),
    field: catalogCorrectionFieldSchema,
    proposedValue: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.field === 'priceMinor' && !/^(0|[1-9]\d{0,9})$/.test(value.proposedValue)) {
      ctx.addIssue({
        code: 'custom',
        path: ['proposedValue'],
        message: 'Invalid minor-unit price',
      });
    }
    if (value.field === 'isbn' && !/^[0-9Xx-]{10,20}$/.test(value.proposedValue)) {
      ctx.addIssue({ code: 'custom', path: ['proposedValue'], message: 'Invalid ISBN' });
    }
  });
export const reviewCatalogCorrectionSchema = z
  .object({
    verdict: z.enum(['ACCEPTED', 'REJECTED']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const catalogCorrectionRecordSchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  skuId: z.uuid(),
  field: catalogCorrectionFieldSchema,
  originalValue: z.string().nullable(),
  proposedValue: z.string(),
  reason: z.string(),
  status: catalogCorrectionStatusSchema,
  requestedByStaffAccountId: z.uuid(),
  reviewedByStaffAccountId: z.uuid().nullable(),
  reviewReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export const catalogCorrectionsResponseSchema = z.object({
  requests: z.array(catalogCorrectionRecordSchema),
});
export type CreateCatalogCorrection = z.infer<typeof createCatalogCorrectionSchema>;
export type ReviewCatalogCorrection = z.infer<typeof reviewCatalogCorrectionSchema>;
