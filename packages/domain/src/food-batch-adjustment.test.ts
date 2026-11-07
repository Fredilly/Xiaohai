import { describe, expect, it } from 'vitest';
import {
  previewFoodBatchAdjustment,
  type FoodBatchAdjustmentInput,
} from './food-batch-adjustment.js';

const initial: FoodBatchAdjustmentInput = {
  businessDate: '2026-11-07',
  aggregate: {
    storeId: 'store-1',
    skuId: 'sku-1',
    onHand: 10,
    reserved: 2,
    rentalReserved: 0,
    productStatus: 'ACTIVE',
    skuStatus: 'ACTIVE',
    availableForSale: true,
  },
  inventoryVersion: 3,
  batches: [
    {
      id: 'batch-1',
      storeId: 'store-1',
      skuId: 'sku-1',
      expiresOn: '2026-11-30',
      onHand: 10,
      reserved: 2,
      blocked: 1,
      state: 'AVAILABLE',
    },
  ],
  batchId: 'batch-1',
  operation: { kind: 'EXISTING_LOT_RECEIPT', quantity: 3 },
  referenceId: 'receipt-1',
  idempotencyKey: 'receipt-key-1',
  reason: 'Verified goods receipt',
};

const withInput = (changes: Partial<FoodBatchAdjustmentInput>) => ({ ...initial, ...changes });

describe('food lot movement proposal (#208; no persistence)', () => {
  it('returns a dry-run receipt without mutating source records', () => {
    const plan = previewFoodBatchAdjustment(initial);
    expect(plan).toMatchObject({
      mode: 'DRY_RUN_ONLY',
      persisted: false,
      checkoutEnabled: false,
      expectedInventoryVersion: 3,
      quantityDelta: 3,
      beforeBatchOnHand: 10,
      afterBatchOnHand: 13,
      beforeAggregateOnHand: 10,
      afterAggregateOnHand: 13,
      afterSellable: 10,
    });
    expect(initial.aggregate.onHand).toBe(10);
    expect(initial.batches[0]?.onHand).toBe(10);
  });

  it('allows loss only from unallocated stock', () => {
    expect(
      previewFoodBatchAdjustment(
        withInput({ operation: { kind: 'DAMAGE', quantity: 7 } }),
      ).quantityDelta,
    ).toBe(-7);
    expect(() =>
      previewFoodBatchAdjustment(withInput({ operation: { kind: 'DAMAGE', quantity: 8 } })),
    ).toThrow('INSUFFICIENT_UNALLOCATED_FOOD_STOCK');
    expect(
      previewFoodBatchAdjustment(
        withInput({ operation: { kind: 'STOCKTAKE_LOSS', countedOnHand: 5 } }),
      ).afterBatchOnHand,
    ).toBe(5);
  });

  it('rejects unexplained stocktake gains or no-op counts', () => {
    for (const countedOnHand of [10, 11, -1, 1.1]) {
      expect(() =>
        previewFoodBatchAdjustment(
          withInput({ operation: { kind: 'STOCKTAKE_LOSS', countedOnHand } }),
        ),
      ).toThrow('INVALID_STOCKTAKE_LOSS');
    }
  });

  it('fails closed on mismatched totals, foreign stores and missing lots', () => {
    expect(() =>
      previewFoodBatchAdjustment(
        withInput({ aggregate: { ...initial.aggregate, onHand: 11 } }),
      ),
    ).toThrow('UNRECONCILED_FOOD_STOCK');
    expect(() =>
      previewFoodBatchAdjustment(
        withInput({ batches: [{ ...initial.batches[0]!, storeId: 'store-2' }] }),
      ),
    ).toThrow('CROSS_STORE_FOOD_BATCH');
    expect(() => previewFoodBatchAdjustment(withInput({ batches: [] }))).toThrow(
      'UNRECONCILED_FOOD_STOCK',
    );
  });

  it('requires a separate workflow for expired, held and recalled lots', () => {
    expect(() =>
      previewFoodBatchAdjustment(withInput({ businessDate: '2026-12-01' })),
    ).toThrow('FOOD_BATCH_REQUIRES_SEPARATE_DISPOSITION');
    for (const state of ['HELD', 'RECALLED'] as const) {
      expect(() =>
        previewFoodBatchAdjustment(
          withInput({ batches: [{ ...initial.batches[0]!, state }] }),
        ),
      ).toThrow('FOOD_BATCH_REQUIRES_SEPARATE_DISPOSITION');
    }
  });

  it('rejects invalid expected versions, evidence and quantities', () => {
    expect(() =>
      previewFoodBatchAdjustment(withInput({ inventoryVersion: -1 })),
    ).toThrow('INVALID_INVENTORY_VERSION');
    expect(() => previewFoodBatchAdjustment(withInput({ reason: '' }))).toThrow(
      'INVALID_ADJUSTMENT_EVIDENCE',
    );
    expect(() =>
      previewFoodBatchAdjustment(
        withInput({ operation: { kind: 'EXISTING_LOT_RECEIPT', quantity: 0 } }),
      ),
    ).toThrow('INVALID_ADJUSTMENT_QUANTITY');
    expect(() =>
      previewFoodBatchAdjustment(
        withInput({ operation: { kind: 'EXISTING_LOT_RECEIPT', quantity: 1_000_000_000 } }),
      ),
    ).toThrow('INSUFFICIENT_UNALLOCATED_FOOD_STOCK');
  });

  it('never implies checkout availability for DRAFT product stock', () => {
    const plan = previewFoodBatchAdjustment(
      withInput({ aggregate: { ...initial.aggregate, productStatus: 'DRAFT' } }),
    );
    expect(plan.checkoutEnabled).toBe(false);
    expect(plan.afterSellable).toBe(0);
  });
});
