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

function plan(changes: Partial<FoodBatchAdjustmentInput> = {}) {
  return previewFoodBatchAdjustment({ ...initial, ...changes });
}

const shortage = 'INSUFFICIENT_UNALLOCATED_FOOD_STOCK';
const unsafeLot = 'FOOD_BATCH_REQUIRES_SEPARATE_DISPOSITION';
const currentLot = initial.batches[0]!;

describe('food lot movement proposal (#208; no persistence)', () => {
  it('returns a dry-run receipt without mutating input', () => {
    expect(plan()).toMatchObject({
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
    expect(currentLot.onHand).toBe(10);
  });

  it('protects reserved and blocked stock from damage', () => {
    const damage = (quantity: number) =>
      plan({ operation: { kind: 'DAMAGE', quantity } });
    expect(damage(7).quantityDelta).toBe(-7);
    expect(() => damage(8)).toThrow(shortage);
    expect(
      plan({ operation: { kind: 'STOCKTAKE_LOSS', countedOnHand: 5 } })
        .afterBatchOnHand,
    ).toBe(5);
  });

  it('rejects stocktake gains and no-op counts', () => {
    for (const countedOnHand of [10, 11, -1, 1.1]) {
      const operation = { kind: 'STOCKTAKE_LOSS', countedOnHand } as const;
      expect(() => plan({ operation })).toThrow('INVALID_STOCKTAKE_LOSS');
    }
  });

  it('rejects mismatched, cross-store and missing batches', () => {
    const aggregate = { ...initial.aggregate, onHand: 11 };
    expect(() => plan({ aggregate })).toThrow('UNRECONCILED_FOOD_STOCK');
    expect(() => plan({ batches: [{ ...currentLot, storeId: 'other' }] })).toThrow(
      'CROSS_STORE_FOOD_BATCH',
    );
    expect(() => plan({ batches: [] })).toThrow('UNRECONCILED_FOOD_STOCK');
  });

  it('rejects expired, held and recalled lots', () => {
    expect(() => plan({ businessDate: '2026-12-01' })).toThrow(unsafeLot);
    for (const state of ['HELD', 'RECALLED'] as const) {
      expect(() => plan({ batches: [{ ...currentLot, state }] })).toThrow(
        unsafeLot,
      );
    }
  });

  it('validates expected version, evidence and quantity', () => {
    expect(() => plan({ inventoryVersion: -1 })).toThrow(
      'INVALID_INVENTORY_VERSION',
    );
    expect(() => plan({ reason: '' })).toThrow('INVALID_ADJUSTMENT_EVIDENCE');
    const receipt = (quantity: number) =>
      plan({ operation: { kind: 'EXISTING_LOT_RECEIPT', quantity } });
    expect(() => receipt(0)).toThrow('INVALID_ADJUSTMENT_QUANTITY');
    expect(() => receipt(1_000_000_000)).toThrow(shortage);
  });

  it('does not enable checkout for DRAFT product stock', () => {
    const aggregate = { ...initial.aggregate, productStatus: 'DRAFT' as const };
    expect(plan({ aggregate })).toMatchObject({
      checkoutEnabled: false,
      afterSellable: 0,
    });
  });
});
