import { describe, expect, it } from 'vitest';
import { planFoodFefoAllocation } from './food-fefo.js';
import type { PackagedFoodStockResult } from './food-stock.js';

const ready: PackagedFoodStockResult = {
  status: 'READY',
  sellable: 10,
  expiredOnHand: 2,
  blockedOnHand: 1,
  batches: [
    { id: 'z', expiresOn: '2099-04-01', disposition: 'AVAILABLE', sellable: 6 },
    { id: 'b', expiresOn: '2099-02-01', disposition: 'AVAILABLE', sellable: 2 },
    { id: 'a', expiresOn: '2099-02-01', disposition: 'AVAILABLE', sellable: 2 },
    { id: 'expired', expiresOn: '2001-01-01', disposition: 'EXPIRED', sellable: 0 },
    { id: 'held', expiresOn: '2099-01-01', disposition: 'HELD', sellable: 0 },
  ],
};

describe('food FEFO allocation plan', () => {
  it('uses expiry order and stable batch ID order; does not mutate its input', () => {
    expect(planFoodFefoAllocation(ready, 5)).toEqual([
      { batchId: 'a', quantity: 2 },
      { batchId: 'b', quantity: 2 },
      { batchId: 'z', quantity: 1 },
    ]);
    expect(ready.batches[0]?.id).toBe('z');
  });

  it('never allocates blocked, expired, held or recalled stock', () => {
    expect(planFoodFefoAllocation(ready, 10)).toHaveLength(3);
    expect(() => planFoodFefoAllocation(ready, 11)).toThrow('INSUFFICIENT_FOOD_STOCK');
    for (const status of ['DISABLED', 'MISMATCH', 'MISSING_BATCHES'] as const) {
      expect(() => planFoodFefoAllocation({ ...ready, status }, 1)).toThrow(
        'INSUFFICIENT_FOOD_STOCK',
      );
    }
  });

  it('rejects malformed quantities', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, 1_000_001]) {
      expect(() => planFoodFefoAllocation(ready, quantity)).toThrow('INVALID_FOOD_QUANTITY');
    }
  });
});
