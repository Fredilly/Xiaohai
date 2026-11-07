import { describe, expect, it } from 'vitest';
import { previewFoodBatchAdjustment } from './food-batch-adjustment.js';
import type { FoodBatchAdjustmentInput } from './food-batch-adjustment.js';

const sample: FoodBatchAdjustmentInput = {
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

function plan(changes: Partial<FoodBatchAdjustmentInput> = {}) {
  return previewFoodBatchAdjustment({ ...sample, ...changes });
}

function fail(changes: Partial<FoodBatchAdjustmentInput>, code: string) {
  expect(() => plan(changes)).toThrow(code);
}

const lot = sample.batches[0]!;
const shortage = 'INSUFFICIENT_UNALLOCATED_FOOD_STOCK';
const unsafeLot = 'FOOD_BATCH_REQUIRES_SEPARATE_DISPOSITION';

describe('food lot movement preflight (#208)', () => {
  it('proposes receipt without persistent writes or checkout', () => {
    const result = plan();
    expect(result.mode).toBe('DRY_RUN_ONLY');
    expect(result.persisted).toBe(false);
    expect(result.checkoutEnabled).toBe(false);
    expect(result.expectedInventoryVersion).toBe(3);
    expect(result.quantityDelta).toBe(3);
    expect(result.beforeBatchOnHand).toBe(10);
    expect(result.afterBatchOnHand).toBe(13);
    expect(result.beforeAggregateOnHand).toBe(10);
    expect(result.afterAggregateOnHand).toBe(13);
    expect(result.afterSellable).toBe(10);
    expect(sample.aggregate.onHand).toBe(10);
    expect(lot.onHand).toBe(10);
  });

  it('protects reserved and blocked stock from damage', () => {
    const loss = { kind: 'DAMAGE' as const, quantity: 7 };
    expect(plan({ operation: loss }).quantityDelta).toBe(-7);
    fail({ operation: { ...loss, quantity: 8 } }, shortage);
    const count = { kind: 'STOCKTAKE_LOSS' as const, countedOnHand: 5 };
    expect(plan({ operation: count }).afterBatchOnHand).toBe(5);
  });

  it('rejects stocktake gains and no-op counts', () => {
    for (const countedOnHand of [10, 11, -1, 1.1]) {
      const operation = { kind: 'STOCKTAKE_LOSS' as const, countedOnHand };
      fail({ operation }, 'INVALID_STOCKTAKE_LOSS');
    }
  });

  it('rejects mismatched, foreign and missing batches', () => {
    const aggregate = { ...sample.aggregate, onHand: 11 };
    fail({ aggregate }, 'UNRECONCILED_FOOD_STOCK');
    fail({ batches: [{ ...lot, storeId: 'other' }] }, 'CROSS_STORE_FOOD_BATCH');
    fail({ batches: [] }, 'UNRECONCILED_FOOD_STOCK');
  });

  it('rejects expired, held and recalled lots', () => {
    fail({ businessDate: '2026-12-01' }, unsafeLot);
    for (const state of ['HELD', 'RECALLED'] as const) {
      fail({ batches: [{ ...lot, state }] }, unsafeLot);
    }
  });

  it('validates expected version, evidence and quantity', () => {
    fail({ inventoryVersion: -1 }, 'INVALID_INVENTORY_VERSION');
    fail({ reason: '' }, 'INVALID_ADJUSTMENT_EVIDENCE');
    const receipt = { kind: 'EXISTING_LOT_RECEIPT' as const, quantity: 0 };
    fail({ operation: receipt }, 'INVALID_ADJUSTMENT_QUANTITY');
    fail({ operation: { ...receipt, quantity: 1_000_000_000 } }, shortage);
  });

  it('does not enable checkout for DRAFT products', () => {
    const aggregate = { ...sample.aggregate, productStatus: 'DRAFT' as const };
    const result = plan({ aggregate });
    expect(result.checkoutEnabled).toBe(false);
    expect(result.afterSellable).toBe(0);
  });
});
