import { describe, expect, it } from 'vitest';
import {
  parseScopedFoodOrder,
  parseScopedFoodStock,
  parseScopedFoodTrace,
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
  businessDate: '2026-11-24',
  inventoryVersion: 1,
  onHand: 0,
  rows: [],
  checkoutEnabled: false,
  result: { status: 'READY', sellable: 0, expiredOnHand: 0, blockedOnHand: 0, batches: [] },
};
const order = { orderId, storeId, status: 'REFUNDED', allocations: [] };
const trace = { batchId, storeId, lotCode: 'SYNTHETIC', transfers: [], returns: [] };

describe('food operations UI response identity boundaries', () => {
  it('accepts only the requested store and SKU before rendering food stock', () => {
    expect(parseScopedFoodStock(stock, storeId, skuId).inventoryVersion).toBe(1);
    expect(() => parseScopedFoodStock({ ...stock, storeId: otherStoreId }, storeId, skuId)).toThrow(
      'FOOD_STOCK_SCOPE_MISMATCH',
    );
    expect(() => parseScopedFoodStock({ ...stock, skuId: otherSkuId }, storeId, skuId)).toThrow(
      'FOOD_STOCK_SCOPE_MISMATCH',
    );
    expect(() => parseScopedFoodStock({ ...stock, onHand: -1 }, storeId, skuId)).toThrow();
  });

  it('rejects other-store or wrong-order allocation responses', () => {
    expect(parseScopedFoodOrder(order, storeId, orderId).orderId).toBe(orderId);
    expect(() =>
      parseScopedFoodOrder({ ...order, storeId: otherStoreId }, storeId, orderId),
    ).toThrow('FOOD_ORDER_SCOPE_MISMATCH');
    expect(() => parseScopedFoodOrder({ ...order, orderId: batchId }, storeId, orderId)).toThrow(
      'FOOD_ORDER_SCOPE_MISMATCH',
    );
  });

  it('rejects other-store or wrong-batch provenance responses', () => {
    expect(parseScopedFoodTrace(trace, storeId, batchId).lotCode).toBe('SYNTHETIC');
    expect(() =>
      parseScopedFoodTrace({ ...trace, storeId: otherStoreId }, storeId, batchId),
    ).toThrow('FOOD_TRACE_SCOPE_MISMATCH');
    expect(() => parseScopedFoodTrace({ ...trace, batchId: skuId }, storeId, batchId)).toThrow(
      'FOOD_TRACE_SCOPE_MISMATCH',
    );
  });
});
