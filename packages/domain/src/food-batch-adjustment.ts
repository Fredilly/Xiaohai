import { evaluatePackagedFoodStock } from './food-stock.js';
import type { PackagedFoodAggregate, PackagedFoodBatch } from './food-stock.js';

/** Strict, offline preflight only. This module never writes stock or a ledger. */
export type FoodBatchAdjustment =
  | { kind: 'EXISTING_LOT_RECEIPT'; quantity: number }
  | { kind: 'DAMAGE'; quantity: number }
  | { kind: 'STOCKTAKE_LOSS'; countedOnHand: number };

export type FoodBatchAdjustmentInput = {
  businessDate: string;
  aggregate: PackagedFoodAggregate;
  inventoryVersion: number;
  batches: readonly PackagedFoodBatch[];
  batchId: string;
  operation: FoodBatchAdjustment;
  referenceId: string;
  idempotencyKey: string;
  reason: string;
};

export type FoodBatchAdjustmentPlan = {
  mode: 'DRY_RUN_ONLY';
  persisted: false;
  checkoutEnabled: false;
  storeId: string;
  skuId: string;
  batchId: string;
  expectedInventoryVersion: number;
  referenceId: string;
  idempotencyKey: string;
  reason: string;
  operationKind: FoodBatchAdjustment['kind'];
  quantityDelta: number;
  beforeBatchOnHand: number;
  afterBatchOnHand: number;
  beforeAggregateOnHand: number;
  afterAggregateOnHand: number;
  afterSellable: number;
};

const MAX_QUANTITY = 1_000_000_000;
const MAX_PG_VERSION = 2_147_483_646;

function validQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUANTITY;
}

/**
 * Plans a conservative movement on an already-existing, reconciled lot.
 *
 * No new lots, expiry disposal, recalls, reservation allocation, transfers,
 * stocktake gains or database writes. Future persistence MUST authenticate
 * staff, lock both rows, verify expected versions and ledger idempotency,
 * update the aggregate and lot atomically and append immutable events.
 */
export function previewFoodBatchAdjustment(
  input: FoodBatchAdjustmentInput,
): FoodBatchAdjustmentPlan {
  const { aggregate, batches, batchId, businessDate, operation } = input;
  if (
    !Number.isSafeInteger(input.inventoryVersion) ||
    input.inventoryVersion < 0 ||
    input.inventoryVersion > MAX_PG_VERSION
  ) {
    throw new Error('INVALID_INVENTORY_VERSION');
  }
  if (
    !input.referenceId.trim() ||
    input.referenceId.length > 128 ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128 ||
    !input.reason.trim() ||
    input.reason.length > 500
  ) {
    throw new Error('INVALID_ADJUSTMENT_EVIDENCE');
  }
  const before = evaluatePackagedFoodStock({ businessDate, aggregate, batches });
  if (before.status === 'MISMATCH' || before.status === 'MISSING_BATCHES') {
    throw new Error('UNRECONCILED_FOOD_STOCK');
  }

  const target = batches.find((batch) => batch.id === batchId);
  if (!target) throw new Error('UNKNOWN_FOOD_BATCH');
  if (target.state !== 'AVAILABLE' || target.expiresOn < businessDate) {
    throw new Error('FOOD_BATCH_REQUIRES_SEPARATE_DISPOSITION');
  }

  let delta: number;
  switch (operation.kind) {
    case 'EXISTING_LOT_RECEIPT':
      if (!validQuantity(operation.quantity) || operation.quantity === 0) {
        throw new Error('INVALID_ADJUSTMENT_QUANTITY');
      }
      delta = operation.quantity;
      break;
    case 'DAMAGE':
      if (!validQuantity(operation.quantity) || operation.quantity === 0) {
        throw new Error('INVALID_ADJUSTMENT_QUANTITY');
      }
      delta = -operation.quantity;
      break;
    case 'STOCKTAKE_LOSS':
      if (!validQuantity(operation.countedOnHand) || operation.countedOnHand >= target.onHand) {
        throw new Error('INVALID_STOCKTAKE_LOSS');
      }
      delta = operation.countedOnHand - target.onHand;
      break;
    default:
      throw new Error('UNSUPPORTED_ADJUSTMENT');
  }

  const nextBatchOnHand = target.onHand + delta;
  const nextAggregateOnHand = aggregate.onHand + delta;
  if (
    !validQuantity(nextBatchOnHand) ||
    !validQuantity(nextAggregateOnHand) ||
    nextBatchOnHand < target.reserved + target.blocked ||
    nextAggregateOnHand < aggregate.reserved + aggregate.rentalReserved
  ) {
    throw new Error('INSUFFICIENT_UNALLOCATED_FOOD_STOCK');
  }

  const changedBatches = batches.map((batch) =>
    batch.id === batchId ? { ...batch, onHand: nextBatchOnHand } : batch,
  );
  const after = evaluatePackagedFoodStock({
    businessDate,
    aggregate: { ...aggregate, onHand: nextAggregateOnHand },
    batches: changedBatches,
  });
  if (after.status === 'MISMATCH' || after.status === 'MISSING_BATCHES') {
    throw new Error('UNRECONCILED_FOOD_STOCK');
  }

  return {
    mode: 'DRY_RUN_ONLY',
    persisted: false,
    checkoutEnabled: false,
    storeId: aggregate.storeId,
    skuId: aggregate.skuId,
    batchId,
    expectedInventoryVersion: input.inventoryVersion,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    operationKind: operation.kind,
    quantityDelta: delta,
    beforeBatchOnHand: target.onHand,
    afterBatchOnHand: nextBatchOnHand,
    beforeAggregateOnHand: aggregate.onHand,
    afterAggregateOnHand: nextAggregateOnHand,
    afterSellable: after.sellable,
  };
}
