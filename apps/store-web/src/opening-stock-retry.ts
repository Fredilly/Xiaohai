import {
  openingStockRegistrationRequestSchema,
  openingStockRegistrationResponseSchema,
  type OpeningStockRegistrationRequest,
} from '@xiaohai/contracts/inventory';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export type PendingOpeningStock = { skuCode: string; input: OpeningStockRegistrationRequest };

function storageKey(staffId: string, storeId: string): string {
  if (!uuid.test(staffId) || !uuid.test(storeId))
    throw new Error('首次库存建档员工或门店上下文无效');
  return `xiaohai.staff.inventory.opening.pending.${staffId.toLowerCase()}.${storeId.toLowerCase()}`;
}

function skuCodeForReplay(skuCode: string): string {
  if (!skuCode || skuCode.trim() !== skuCode || skuCode.length > 120)
    throw new Error('首次建档 SKU 编码无效');
  return skuCode;
}

export function pendingOpeningStock(staffId: string, storeId: string): PendingOpeningStock | null {
  const raw = sessionStorage.getItem(storageKey(staffId, storeId));
  if (raw === null) return null;
  if (raw.length > 8000) throw new Error('待确认首次库存建档记录无效');
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error('INVALID');
    const record = value as Record<string, unknown>;
    const skuCode = skuCodeForReplay(record.skuCode as string);
    const input = openingStockRegistrationRequestSchema.parse(record.input);
    if (input.storeId !== storeId || JSON.stringify(input) !== JSON.stringify(record.input))
      throw new Error('INVALID');
    return { skuCode, input };
  } catch {
    throw new Error('待确认首次库存建档记录无效，请核对门店真实库存');
  }
}

function withoutKey(input: OpeningStockRegistrationRequest): string {
  const body: Record<string, unknown> = { ...input };
  delete body.idempotencyKey;
  return JSON.stringify(body);
}

export function reserveOpeningStock(
  staffId: string,
  storeId: string,
  skuCode: string,
  input: OpeningStockRegistrationRequest,
): PendingOpeningStock {
  const code = skuCodeForReplay(skuCode);
  const parsed = openingStockRegistrationRequestSchema.parse(input);
  if (parsed.storeId !== storeId) throw new Error('首次库存建档门店不符');
  const previous = pendingOpeningStock(staffId, storeId);
  if (previous) {
    if (previous.skuCode !== code || withoutKey(previous.input) !== withoutKey(parsed))
      throw new Error('上次首次库存建档尚未确认，请先恢复原请求或核对库存记录');
    return previous;
  }
  const saved = { skuCode: code, input: parsed };
  sessionStorage.setItem(storageKey(staffId, storeId), JSON.stringify(saved));
  if (pendingOpeningStock(staffId, storeId)?.input.idempotencyKey !== parsed.idempotencyKey)
    throw new Error('首次建档请求键未能安全保存，已阻止写入');
  return saved;
}

export function assertOpeningStockResponse(input: OpeningStockRegistrationRequest, raw: unknown) {
  const result = openingStockRegistrationResponseSchema.parse(raw);
  if (
    result.storeId !== input.storeId ||
    result.skuId !== input.skuId ||
    result.onHand !== input.initialQuantity ||
    result.version !== (input.initialQuantity > 0 ? 1 : 0)
  )
    throw new Error('OPENING_STOCK_RESPONSE_MISMATCH');
  return result;
}

export function clearOpeningStock(staffId: string, storeId: string, requestKey: string): void {
  const previous = pendingOpeningStock(staffId, storeId);
  if (!previous) return;
  if (previous.input.idempotencyKey !== requestKey)
    throw new Error('首次库存建档请求键冲突，已停止操作');
  sessionStorage.removeItem(storageKey(staffId, storeId));
}
