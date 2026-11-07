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
