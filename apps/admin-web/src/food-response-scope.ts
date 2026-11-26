import {
  foodOrderAllocationsResponseSchema,
  foodStockReadResponseSchema,
  foodTraceResponseSchema,
} from '@xiaohai/contracts/food';

// HQ can select different stores without changing identity. Do not render a
// well-formed response unless it belongs to the requested store and object.
export function parseScopedHqFoodStock(raw: unknown, storeId: string, skuId: string) {
  const result = foodStockReadResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.skuId !== skuId)
    throw new Error('HQ_FOOD_STOCK_SCOPE_MISMATCH');
  return result;
}

export function parseScopedHqFoodOrder(raw: unknown, storeId: string, orderId: string) {
  const result = foodOrderAllocationsResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.orderId !== orderId)
    throw new Error('HQ_FOOD_ORDER_SCOPE_MISMATCH');
  return result;
}

export function parseScopedHqFoodTrace(raw: unknown, storeId: string, batchId: string) {
  const result = foodTraceResponseSchema.parse(raw);
  if (result.storeId !== storeId || result.batchId !== batchId)
    throw new Error('HQ_FOOD_TRACE_SCOPE_MISMATCH');
  return result;
}
