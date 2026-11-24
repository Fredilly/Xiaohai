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
