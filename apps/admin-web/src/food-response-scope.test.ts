import { describe, expect, it } from 'vitest';
import {
  parseScopedHqFoodOrder,
  parseScopedHqFoodStock,
  parseScopedHqFoodTrace,
} from './food-response-scope';

const storeId = '11111111-1111-4111-8111-111111111111';
const otherStoreId = '33333333-3333-4333-8333-333333333333';
const skuId = '22222222-2222-4222-8222-222222222222';
const otherSkuId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const batchId = '66666666-6666-4666-8666-666666666666';

const stock = {
  storeId,
  skuId,
  businessDate: '2026-11-26',
  inventoryVersion: 1,
  onHand: 0,
  rows: [],
  checkoutEnabled: false,
  result: { status: 'READY', sellable: 0, expiredOnHand: 0, blockedOnHand: 0, batches: [] },
};
const order = { orderId, storeId, status: 'REFUNDED', allocations: [] };
const trace = { batchId, storeId, lotCode: 'SYNTHETIC', transfers: [], returns: [] };

describe('HQ selected-store food response boundaries (#208)', () => {
  it('rejects a valid response from another store or SKU', () => {
    expect(parseScopedHqFoodStock(stock, storeId, skuId).inventoryVersion).toBe(1);
    expect(() =>
      parseScopedHqFoodStock({ ...stock, storeId: otherStoreId }, storeId, skuId),
    ).toThrow('HQ_FOOD_STOCK_SCOPE_MISMATCH');
    expect(() => parseScopedHqFoodStock({ ...stock, skuId: otherSkuId }, storeId, skuId)).toThrow(
      'HQ_FOOD_STOCK_SCOPE_MISMATCH',
    );
    expect(() => parseScopedHqFoodStock({ ...stock, onHand: -1 }, storeId, skuId)).toThrow();
  });

  it('rejects another store or order before displaying returned goods allocations', () => {
    expect(parseScopedHqFoodOrder(order, storeId, orderId).status).toBe('REFUNDED');
    expect(() =>
      parseScopedHqFoodOrder({ ...order, storeId: otherStoreId }, storeId, orderId),
    ).toThrow('HQ_FOOD_ORDER_SCOPE_MISMATCH');
    expect(() => parseScopedHqFoodOrder({ ...order, orderId: batchId }, storeId, orderId)).toThrow(
      'HQ_FOOD_ORDER_SCOPE_MISMATCH',
    );
  });

  it('rejects another store or batch before displaying provenance', () => {
    expect(parseScopedHqFoodTrace(trace, storeId, batchId).lotCode).toBe('SYNTHETIC');
    expect(() =>
      parseScopedHqFoodTrace({ ...trace, storeId: otherStoreId }, storeId, batchId),
    ).toThrow('HQ_FOOD_TRACE_SCOPE_MISMATCH');
    expect(() => parseScopedHqFoodTrace({ ...trace, batchId: skuId }, storeId, batchId)).toThrow(
      'HQ_FOOD_TRACE_SCOPE_MISMATCH',
    );
  });
});
