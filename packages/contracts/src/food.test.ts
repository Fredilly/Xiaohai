import { describe, expect, it } from 'vitest';
import { packagedFoodBatchSchema, packagedFoodDraftMetadataSchema } from './food.js';

const productId = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';

const batch = {
  id: batchId,
  storeId,
  skuId,
  lotCode: 'LOT-2026-11-A',
  manufacturedOn: '2026-10-01',
  expiresOn: '2026-12-01',
  onHand: 20,
  reserved: 3,
  blocked: 1,
  state: 'AVAILABLE',
};

describe('packaged food metadata and batch contract (#208)', () => {
  it('validates real-food types without requiring ISBN or author', () => {
    expect(
      packagedFoodDraftMetadataSchema.parse({
        productId,
        kind: 'PACKAGED_FOOD',
        brand: '本地烘焙',
        unit: 'BAG',
        netContent: '120g',
      }),
    ).toMatchObject({ productId, unit: 'BAG' });
    expect(
      packagedFoodDraftMetadataSchema.safeParse({
        productId,
        kind: 'PREPARED_DRINK',
        brand: null,
        unit: 'BOTTLE',
        netContent: null,
      }).success,
    ).toBe(false);
  });

  it('accepts traceable batches and refuses misleading or incomplete batch data', () => {
    expect(packagedFoodBatchSchema.parse(batch)).toMatchObject({
      lotCode: 'LOT-2026-11-A',
      expiresOn: '2026-12-01',
    });
    expect(packagedFoodBatchSchema.safeParse({ ...batch, expiresOn: null }).success).toBe(false);
    expect(packagedFoodBatchSchema.safeParse({ ...batch, expiresOn: '2026-02-30' }).success).toBe(
      false,
    );
    expect(packagedFoodBatchSchema.safeParse({ ...batch, blocked: 18 }).success).toBe(false);
    expect(
      packagedFoodBatchSchema.safeParse({ ...batch, manufacturedOn: '2027-01-01' }).success,
    ).toBe(false);
    expect(packagedFoodBatchSchema.safeParse({ ...batch, extra: 'internal' }).success).toBe(false);
  });
});
