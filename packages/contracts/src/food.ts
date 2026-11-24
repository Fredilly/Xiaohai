import { z } from 'zod';

/**
 * Draft data contract for packaged food / factory-sealed beverages only.
 * Prepared food and drinks intentionally require a separate recipe decision.
 */
export const packagedFoodKindSchema = z.enum(['PACKAGED_FOOD', 'SEALED_BEVERAGE']);
export const packagedFoodUnitSchema = z.enum(['PIECE', 'BAG', 'BOX', 'BOTTLE', 'PACK']);
export const packagedFoodBatchStateSchema = z.enum(['AVAILABLE', 'HELD', 'RECALLED']);

const stockQuantity = z.number().int().min(0).max(1_000_000_000);
const batchIdentity = z
  .object({
    id: z.uuid(),
    storeId: z.uuid(),
    skuId: z.uuid(),
    lotCode: z.string().trim().min(1).max(100),
    manufacturedOn: z.iso.date().nullable(),
    expiresOn: z.iso.date(),
    onHand: stockQuantity,
    reserved: stockQuantity,
    blocked: stockQuantity,
    state: packagedFoodBatchStateSchema,
  })
  .strict();

export const packagedFoodBatchSchema = batchIdentity.superRefine((value, ctx) => {
  if (value.reserved + value.blocked > value.onHand) {
    ctx.addIssue({ code: 'custom', path: ['onHand'], message: 'Batch allocation exceeds stock' });
  }
  if (value.manufacturedOn && value.expiresOn < value.manufacturedOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresOn'],
      message: 'Expiry must not precede manufacture date',
    });
  }
});

export const packagedFoodDraftMetadataSchema = z
  .object({
    productId: z.uuid(),
    kind: packagedFoodKindSchema,
    brand: z.string().trim().max(120).nullable(),
    unit: packagedFoodUnitSchema,
    netContent: z.string().trim().max(100).nullable(),
  })
  .strict();

export type PackagedFoodBatch = z.infer<typeof packagedFoodBatchSchema>;
export type PackagedFoodDraftMetadata = z.infer<typeof packagedFoodDraftMetadataSchema>;

/** Proposed batch input is not persisted or approved for public checkout. */
export const packagedFoodPreviewRequestSchema = z
  .object({
    businessDate: z.iso.date(),
    batches: z.array(packagedFoodBatchSchema).max(500),
  })
  .strict();

export const packagedFoodPreviewResponseSchema = z.object({
  mode: z.literal('READ_ONLY_PROPOSAL'),
  checkoutEnabled: z.literal(false),
  storeId: z.uuid(),
  skuId: z.uuid(),
  businessDate: z.iso.date(),
  result: z.object({
    status: z.enum(['READY', 'MISSING_BATCHES', 'MISMATCH', 'DISABLED']),
    sellable: stockQuantity,
    expiredOnHand: stockQuantity,
    blockedOnHand: stockQuantity,
    batches: z.array(
      z.object({
        id: z.uuid(),
        expiresOn: z.iso.date(),
        disposition: z.enum(['AVAILABLE', 'EXPIRED', 'HELD', 'RECALLED']),
        sellable: stockQuantity,
      }),
    ),
  }),
});

export type PackagedFoodPreviewRequest = z.infer<typeof packagedFoodPreviewRequestSchema>;

/** One explicit movement, split across already registered lots of one Store/SKU. */
export const foodBatchMovementRequestSchema = z
  .object({
    storeId: z.uuid(),
    skuId: z.uuid(),
    expectedInventoryVersion: z.number().int().min(0).max(2_147_483_646),
    kind: z.enum(['EXISTING_LOT_RECEIPT', 'DAMAGE', 'STOCKTAKE_LOSS']),
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    lines: z
      .array(
        z
          .object({
            batchId: z.uuid(),
            expectedVersion: z.number().int().min(0).max(2_147_483_646),
            quantity: z.number().int().min(1).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.batchId)).size === value.lines.length,
    'DUPLICATE_FOOD_BATCH',
  );

export type FoodBatchMovementRequest = z.infer<typeof foodBatchMovementRequestSchema>;
