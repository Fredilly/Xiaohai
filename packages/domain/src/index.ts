export interface ConsumerIdentity {
  consumerUserId: string;
  wechatIdentityId: string;
}

export { evaluatePackagedFoodStock } from './food-stock.js';
export type {
  PackagedFoodAggregate,
  PackagedFoodBatch,
  PackagedFoodBatchState,
  PackagedFoodStockResult,
} from './food-stock.js';

export { previewFoodBatchAdjustment } from './food-batch-adjustment.js';
export type {
  FoodBatchAdjustment,
  FoodBatchAdjustmentInput,
  FoodBatchAdjustmentPlan,
} from './food-batch-adjustment.js';
