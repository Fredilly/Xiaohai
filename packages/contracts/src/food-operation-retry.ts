import {
  foodBatchMovementRequestSchema,
  foodLotDispositionRequestSchema,
  foodLotIntakeRequestSchema,
  type FoodBatchMovementRequest,
  type FoodLotDispositionRequest,
  type FoodLotIntakeRequest,
} from './food.js';
import { z } from 'zod';

// Browser-only session helper shared by Store Web and HQ Web. It is never
// imported by the API or worker. One unconfirmed stock write per staff/store:
// switching SKU, changing quantity or reloading must not create a second key.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export type FoodOperationPath = '/intake' | '/disposition' | '/movements';
export type FoodOperationInput =
  FoodLotIntakeRequest | FoodLotDispositionRequest | FoodBatchMovementRequest;
export type PendingFoodOperation = { path: FoodOperationPath; input: FoodOperationInput };

const persistedStock = z.number().int().nonnegative().max(1_000_000_000);
const receiptResponse = z.object({
  batchId: z.uuid(),
  onHandAfter: persistedStock,
  inventoryVersion: persistedStock,
  replayed: z.boolean(),
});
const dispositionResponse = z.object({
  batchId: z.uuid(),
  state: z.enum(['AVAILABLE', 'HELD', 'RECALLED']),
  version: persistedStock,
  inventoryVersion: persistedStock,
  replayed: z.boolean(),
});
const movementResponse = z.object({
  aggregateTransactionId: z.uuid(),
  balanceAfter: persistedStock,
  version: persistedStock,
  replayed: z.boolean(),
});

export function assertFoodOperationResponse(operation: PendingFoodOperation, raw: unknown): void {
  const expectedVersion = operation.input.expectedInventoryVersion + 1;
  switch (operation.path) {
    case '/intake': {
      const response = receiptResponse.parse(raw);
      if (response.inventoryVersion !== expectedVersion) throw new Error('FOOD_RESULT_MISMATCH');
      break;
    }
    case '/disposition': {
      const response = dispositionResponse.parse(raw);
      const input = operation.input as FoodLotDispositionRequest;
      if (
        response.batchId !== input.batchId ||
        response.state !== input.state ||
        response.inventoryVersion !== expectedVersion ||
        response.version !== input.expectedVersion + 1
      )
        throw new Error('FOOD_RESULT_MISMATCH');
      break;
    }
    case '/movements': {
      const response = movementResponse.parse(raw);
      if (response.version !== expectedVersion) throw new Error('FOOD_RESULT_MISMATCH');
      break;
    }
  }
}

function key(staffId: string, storeId: string): string {
  if (!uuid.test(staffId) || !uuid.test(storeId)) throw new Error('食品批次账号或门店上下文无效');
  return `xiaohai.staff.food.pending.${staffId.toLowerCase()}.${storeId.toLowerCase()}`;
}

function canonical(path: FoodOperationPath, input: FoodOperationInput): FoodOperationInput {
  switch (path) {
    case '/intake':
      return foodLotIntakeRequestSchema.parse(input);
    case '/disposition':
      return foodLotDispositionRequestSchema.parse(input);
    case '/movements':
      return foodBatchMovementRequestSchema.parse(input);
    default:
      throw new Error('食品批次操作类型无效');
  }
}

export function pendingFoodOperation(
  staffId: string,
  storeId: string,
): PendingFoodOperation | null {
  const raw = sessionStorage.getItem(key(staffId, storeId));
  if (raw === null) return null;
  if (raw.length > 16000) throw new Error('待确认食品批次操作记录无效，请核对流水');
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error('INVALID');
    const record = value as Record<string, unknown>;
    if (!['/intake', '/disposition', '/movements'].includes(String(record.path)))
      throw new Error('INVALID');
    const path = record.path as FoodOperationPath;
    const input = canonical(path, record.input as FoodOperationInput);
    if (input.storeId !== storeId || JSON.stringify(input) !== JSON.stringify(record.input))
      throw new Error('INVALID');
    return { path, input };
  } catch {
    throw new Error('待确认食品批次操作记录无效，请核对流水');
  }
}

function withoutKey(input: FoodOperationInput): string {
  const body: Record<string, unknown> = { ...input };
  delete body.idempotencyKey;
  return JSON.stringify(body);
}

export function reserveFoodOperation(
  staffId: string,
  storeId: string,
  path: FoodOperationPath,
  input: FoodOperationInput,
): PendingFoodOperation {
  const validated = canonical(path, input);
  if (validated.storeId !== storeId) throw new Error('食品批次操作门店不符');
  const existing = pendingFoodOperation(staffId, storeId);
  if (existing) {
    if (existing.path !== path || withoutKey(existing.input) !== withoutKey(validated))
      throw new Error('上次食品批次写入尚未确认，请先用原请求重试或核对流水');
    return existing;
  }
  const pending = { path, input: validated };
  sessionStorage.setItem(key(staffId, storeId), JSON.stringify(pending));
  if (pendingFoodOperation(staffId, storeId)?.input.idempotencyKey !== validated.idempotencyKey)
    throw new Error('无法安全保存食品批次请求键，已停止提交');
  return pending;
}

export function clearFoodOperation(staffId: string, storeId: string, requestKey: string): void {
  const existing = pendingFoodOperation(staffId, storeId);
  if (!existing) return;
  if (existing.input.idempotencyKey !== requestKey)
    throw new Error('食品批次请求键冲突，已停止操作');
  sessionStorage.removeItem(key(staffId, storeId));
}
