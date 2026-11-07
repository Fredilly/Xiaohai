import { and, eq } from 'drizzle-orm';
import {
  products,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import {
  packagedFoodPreviewResponseSchema,
  type PackagedFoodPreviewRequest,
} from '@xiaohai/contracts/food';
import { evaluatePackagedFoodStock } from '@xiaohai/domain';

type Database = ReturnType<typeof createDatabase>['db'];

export class FoodBatchPreviewError extends Error {
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
  }
}

/** Read-only simulation backed by actual store_inventory totals.
 *
 * The proposed batches come from an operator request, NOT from persisted
 * source-of-truth food batch rows. In particular a positive sellable amount
 * here must NEVER authorize cart checkout, stock mutation or public listing.
 */
export class FoodBatchPreviewService {
  constructor(private readonly db: Database) {}

  async preview(storeId: string, skuId: string, input: PackagedFoodPreviewRequest) {
    const [row] = await this.db
      .select({
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        productStatus: products.status,
        skuStatus: skus.status,
        availableForSale: skus.availableForSale,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(skus.id, storeInventory.skuId))
      .innerJoin(products, eq(products.id, skus.productId))
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
      .limit(1);
    if (!row) throw new FoodBatchPreviewError('NOT_FOUND');

    // Validate store/sku identity even for disabled and expired lots: reject
    // all foreign store or foreign SKU references, never silently omit them.
    const result = evaluatePackagedFoodStock({
      businessDate: input.businessDate,
      aggregate: {
        storeId,
        skuId,
        onHand: row.onHand,
        reserved: row.reserved,
        rentalReserved: row.rentalReserved,
        productStatus: row.productStatus as 'DRAFT' | 'ACTIVE' | 'INACTIVE',
        skuStatus: row.skuStatus as 'ACTIVE' | 'INACTIVE',
        availableForSale: row.availableForSale,
      },
      batches: input.batches,
    });

    return packagedFoodPreviewResponseSchema.parse({
      mode: 'READ_ONLY_PROPOSAL',
      checkoutEnabled: false,
      storeId,
      skuId,
      businessDate: input.businessDate,
      result,
    });
  }
}
