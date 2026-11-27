import { foodPhysicalReturnRequestSchema, type FoodPhysicalReturnRequest } from './food.js';
import { z } from 'zod';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const returnResponseSchema = z.object({ returnedBatchId: z.uuid(), replayed: z.boolean() });

export type PendingFoodReturn = {
  storeId: string;
  orderId: string;
  input: FoodPhysicalReturnRequest;
};

function storageKey(staffAccountId: string, storeId: string): string {
  if (!uuid.test(staffAccountId) || !uuid.test(storeId))
    throw new Error('食品实物接收账号或门店上下文无效');
  return `xiaohai.staff.food.return.pending.${staffAccountId.toLowerCase()}.${storeId.toLowerCase()}`;
}

export function pendingFoodReturn(
  staffAccountId: string,
  storeId: string,
): PendingFoodReturn | null {
  const raw = sessionStorage.getItem(storageKey(staffAccountId, storeId));
  if (raw === null) return null;
  if (raw.length > 8000) throw new Error('待确认实物接收记录无效');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('INVALID');
    const record = parsed as Record<string, unknown>;
    if (
      record.storeId !== storeId ||
      typeof record.orderId !== 'string' ||
      !uuid.test(record.orderId)
    )
      throw new Error('INVALID');
    const input = foodPhysicalReturnRequestSchema.parse(record.input);
    if (JSON.stringify(input) !== JSON.stringify(record.input)) throw new Error('INVALID');
    return { storeId, orderId: record.orderId, input };
  } catch {
    throw new Error('待确认实物接收记录无效，请核对真实批次及流水');
  }
}

function fingerprint(input: FoodPhysicalReturnRequest) {
  const withoutKey: Record<string, unknown> = { ...input };
  delete withoutKey.idempotencyKey;
  return JSON.stringify(withoutKey);
}

export function reserveFoodReturn(
  staffAccountId: string,
  storeId: string,
  orderId: string,
  input: FoodPhysicalReturnRequest,
): PendingFoodReturn {
  if (!uuid.test(orderId)) throw new Error('食品退货原订单上下文无效');
  const canonical = foodPhysicalReturnRequestSchema.parse(input);
  const existing = pendingFoodReturn(staffAccountId, storeId);
  if (existing) {
    if (existing.orderId !== orderId || fingerprint(existing.input) !== fingerprint(canonical))
      throw new Error('上次实物退货结果未确认，必须先核对流水或使用原请求键重试');
    return existing;
  }
  const pending = { storeId, orderId, input: canonical };
  sessionStorage.setItem(storageKey(staffAccountId, storeId), JSON.stringify(pending));
  if (pendingFoodReturn(staffAccountId, storeId)?.input.idempotencyKey !== canonical.idempotencyKey)
    throw new Error('无法安全保存实物退货请求键，已停止提交');
  return pending;
}

export function assertFoodReturnResponse(raw: unknown): void {
  returnResponseSchema.parse(raw);
}

export function clearFoodReturn(staffAccountId: string, storeId: string, requestKey: string): void {
  const pending = pendingFoodReturn(staffAccountId, storeId);
  if (!pending) return;
  if (pending.input.idempotencyKey !== requestKey)
    throw new Error('实物退货请求键发生冲突，已停止操作');
  sessionStorage.removeItem(storageKey(staffAccountId, storeId));
}
