import {
  inventoryAdjustmentRequestSchema,
  inventoryMutationRequestSchema,
  inventoryTransactionSchema,
  type InventoryAdjustmentRequest,
  type InventoryMutationRequest,
} from '@xiaohai/contracts/inventory';

type Operation = 'ISSUE' | 'ADJUST';
export type PendingInventoryMutation =
  | { operation: 'ISSUE'; input: InventoryMutationRequest }
  | { operation: 'ADJUST'; input: InventoryAdjustmentRequest };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function storageKey(staffId: string, storeId: string) {
  if (!uuid.test(staffId) || !uuid.test(storeId)) throw new Error('库存操作身份上下文无效');
  return `xiaohai.staff.inventory.mutation.pending.${staffId.toLowerCase()}.${storeId.toLowerCase()}`;
}

function parsePending(operation: Operation, input: unknown): PendingInventoryMutation {
  return operation === 'ISSUE'
    ? { operation, input: inventoryMutationRequestSchema.parse(input) }
    : { operation, input: inventoryAdjustmentRequestSchema.parse(input) };
}

export function pendingInventoryMutation(
  staffId: string,
  storeId: string,
): PendingInventoryMutation | null {
  const raw = sessionStorage.getItem(storageKey(staffId, storeId));
  if (raw === null) return null;
  if (raw.length > 8000) throw new Error('待确认库存记录无效');
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object') throw new Error('INVALID');
    const value = record as Record<string, unknown>;
    if (value.operation !== 'ISSUE' && value.operation !== 'ADJUST') throw new Error('INVALID');
    const parsed = parsePending(value.operation, value.input);
    if (parsed.input.storeId !== storeId || JSON.stringify(parsed) !== JSON.stringify(record))
      throw new Error('INVALID');
    return parsed;
  } catch {
    throw new Error('待确认库存记录无效，请人工核对本店库存流水');
  }
}

function withoutKey(value: PendingInventoryMutation) {
  const input: Record<string, unknown> = { ...value.input };
  delete input.idempotencyKey;
  return JSON.stringify({ operation: value.operation, input });
}

export function reserveInventoryMutation(
  staffId: string,
  storeId: string,
  operation: Operation,
  input: InventoryMutationRequest | InventoryAdjustmentRequest,
): PendingInventoryMutation {
  const parsed = parsePending(operation, input);
  if (parsed.input.storeId !== storeId) throw new Error('库存操作门店不符');
  const previous = pendingInventoryMutation(staffId, storeId);
  if (previous) {
    if (withoutKey(previous) !== withoutKey(parsed))
      throw new Error('上次库存操作结果未确认，只允许按原参数恢复');
    return previous;
  }
  sessionStorage.setItem(storageKey(staffId, storeId), JSON.stringify(parsed));
  if (
    pendingInventoryMutation(staffId, storeId)?.input.idempotencyKey !== parsed.input.idempotencyKey
  )
    throw new Error('库存操作原请求键无法持久保存，已阻止写入');
  return parsed;
}

export function assertInventoryMutationResponse(
  saved: PendingInventoryMutation,
  staffId: string,
  raw: unknown,
) {
  const result = inventoryTransactionSchema.parse(raw);
  const identity = raw as Record<string, unknown>;
  const delta = saved.operation === 'ISSUE' ? -saved.input.quantity : saved.input.quantityDelta;
  if (
    result.storeId !== saved.input.storeId ||
    result.skuId !== saved.input.skuId ||
    identity.idempotencyKey !== saved.input.idempotencyKey ||
    identity.createdByStaffAccountId !== staffId ||
    result.quantityDelta !== delta ||
    result.transactionType !==
      (saved.operation === 'ISSUE' ? 'ISSUE' : delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT') ||
    result.referenceType !==
      (saved.operation === 'ISSUE' ? 'STOCK_ISSUE' : 'INVENTORY_ADJUSTMENT') ||
    result.reason !== saved.input.reason
  )
    throw new Error('INVENTORY_MUTATION_RESPONSE_MISMATCH');
  return result;
}

export function clearInventoryMutation(staffId: string, storeId: string, requestKey: string) {
  const previous = pendingInventoryMutation(staffId, storeId);
  if (!previous) return;
  if (previous.input.idempotencyKey !== requestKey) throw new Error('库存操作请求键冲突');
  sessionStorage.removeItem(storageKey(staffId, storeId));
}
