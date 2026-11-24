import {
  foodOrderAllocationsResponseSchema,
  foodStockReadResponseSchema,
  foodTraceResponseSchema,
} from '@xiaohai/contracts/food';

export function parseScopedFoodStock(raw: unknown, storeId: string, skuId: string) {
  const result = foodStockReadResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.skuId !== skuId) {
    throw new Error('FOOD_STOCK_SCOPE_MISMATCH');
  }
  return result;
}

export function parseScopedFoodOrder(raw: unknown, storeId: string, orderId: string) {
  const result = foodOrderAllocationsResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.orderId !== orderId) {
    throw new Error('FOOD_ORDER_SCOPE_MISMATCH');
  }
  return result;
}

export function parseScopedFoodTrace(raw: unknown, storeId: string, batchId: string) {
  const result = foodTraceResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.batchId !== batchId) {
    throw new Error('FOOD_TRACE_SCOPE_MISMATCH');
  }
  return result;
}
