import { describe, expect, it } from 'vitest';
import {
  evaluatePackagedFoodStock,
  type PackagedFoodAggregate,
  type PackagedFoodBatch,
} from './food-stock.js';

const aggregate: PackagedFoodAggregate = {
  storeId: 'store-a',
  skuId: 'cookie-sku',
  onHand: 10,
  reserved: 2,
  rentalReserved: 0,
  productStatus: 'ACTIVE',
  skuStatus: 'ACTIVE',
  availableForSale: true,
};

const batches: PackagedFoodBatch[] = [
  {
    id: 'new-lot',
    storeId: 'store-a',
    skuId: 'cookie-sku',
    expiresOn: '2026-11-30',
    onHand: 6,
    reserved: 2,
    blocked: 1,
    state: 'AVAILABLE',
  },
  {
    id: 'expired-lot',
    storeId: 'store-a',
    skuId: 'cookie-sku',
    expiresOn: '2026-11-06',
    onHand: 4,
    reserved: 0,
    blocked: 0,
    state: 'AVAILABLE',
  },
];

describe('packaged food batch safety projection (#208)', () => {
  it('excludes expired and blocked quantities with a store-local business date', () => {
    const result = evaluatePackagedFoodStock({
      businessDate: '2026-11-07',
      aggregate,
      batches,
    });
    expect(result.status).toBe('READY');
    expect(result.sellable).toBe(3);
    expect(result.expiredOnHand).toBe(4);
    expect(result.blockedOnHand).toBe(1);
    expect(result.batches.map((batch) => batch.id)).toEqual(['expired-lot', 'new-lot']);
    expect(result.batches.map((batch) => batch.sellable)).toEqual([0, 3]);
  });

  it('includes the labeled expiry day; an expired lot is not saleable the following day', () => {
    const result = evaluatePackagedFoodStock({
      businessDate: '2026-11-06',
      aggregate,
      batches,
    });
    expect(result.sellable).toBe(7);
    expect(result.expiredOnHand).toBe(0);
  });

  it('holds and recalls batches without selling their remaining stock', () => {
    const held = batches.map((batch) => ({ ...batch }));
    held[0]!.state = 'HELD';
    const result = evaluatePackagedFoodStock({
      businessDate: '2026-11-07',
      aggregate,
      batches: held,
    });
    expect(result.sellable).toBe(0);
    expect(result.batches.find((batch) => batch.id === 'new-lot')?.disposition).toBe('HELD');
    held[0]!.state = 'RECALLED';
    expect(
      evaluatePackagedFoodStock({ businessDate: '2026-11-07', aggregate, batches: held })
        .sellable,
    ).toBe(0);
  });

  it('fails closed if batch counts or reservations do not match store totals', () => {
    const base = { businessDate: '2026-11-07', aggregate, batches };
    expect(evaluatePackagedFoodStock({ ...base, batches: [] })).toMatchObject({
      status: 'MISSING_BATCHES',
      sellable: 0,
    });
    expect(
      evaluatePackagedFoodStock({ ...base, aggregate: { ...aggregate, onHand: 11 } }),
    ).toMatchObject({ status: 'MISMATCH', sellable: 0 });
    expect(
      evaluatePackagedFoodStock({ ...base, aggregate: { ...aggregate, reserved: 1 } }),
    ).toMatchObject({ status: 'MISMATCH', sellable: 0 });
    expect(
      evaluatePackagedFoodStock({ ...base, aggregate: { ...aggregate, rentalReserved: 1 } }),
    ).toMatchObject({ status: 'MISMATCH', sellable: 0 });
  });

  it('refuses sale when product, SKU or sale flag is inactive', () => {
    for (const update of [
      { productStatus: 'DRAFT' as const },
      { productStatus: 'INACTIVE' as const },
      { skuStatus: 'INACTIVE' as const },
      { availableForSale: false },
    ]) {
      const result = evaluatePackagedFoodStock({
        businessDate: '2026-11-07',
        aggregate: { ...aggregate, ...update },
        batches,
      });
      expect(result).toMatchObject({ status: 'DISABLED', sellable: 0 });
    }
  });

  it('rejects cross-store batches, duplicate identities, bad dates and negative balances', () => {
    const base = { businessDate: '2026-11-07', aggregate, batches };
    expect(() =>
      evaluatePackagedFoodStock({
        ...base,
        batches: [{ ...batches[0]!, storeId: 'store-b' }],
      }),
    ).toThrow('CROSS_STORE_FOOD_BATCH');
    expect(() =>
      evaluatePackagedFoodStock({ ...base, batches: [batches[0]!, batches[0]!] }),
    ).toThrow('DUPLICATE_FOOD_BATCH');
    expect(() =>
      evaluatePackagedFoodStock({ ...base, businessDate: '2026-02-30' }),
    ).toThrow('INVALID_BUSINESS_DATE');
    expect(() =>
      evaluatePackagedFoodStock({ ...base, batches: [{ ...batches[0]!, blocked: 5 }] }),
    ).toThrow('INVALID_STOCK_QUANTITY');
    expect(() =>
      evaluatePackagedFoodStock({ ...base, aggregate: { ...aggregate, onHand: -1 } }),
    ).toThrow('INVALID_STOCK_QUANTITY');
  });
});
