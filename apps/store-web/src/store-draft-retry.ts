import {
  adminProductCreateInputSchema,
  type AdminProductCreateInput,
} from '@xiaohai/contracts/commerce';

// A pending draft belongs to one staff account and one store in this tab.
// Never persist the staff token; preserve the exact POST payload and request key.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type PendingStoreDraft = {
  requestKey: string;
  input: AdminProductCreateInput;
};

function storageKey(staffAccountId: string, storeId: string): string {
  if (!uuid.test(staffAccountId) || !uuid.test(storeId))
    throw new Error('商品草稿账号或门店上下文无效');
  return `xiaohai.staff.catalog.pending.${staffAccountId.toLowerCase()}.${storeId.toLowerCase()}`;
}

function canonicalInput(input: AdminProductCreateInput): AdminProductCreateInput {
  const parsed = adminProductCreateInputSchema.parse(input);
  if (parsed.status !== 'DRAFT' || parsed.sku.availableForSale)
    throw new Error('只允许保存未上架、不可售的草稿');
  return parsed;
}

export function pendingStoreDraft(
  staffAccountId: string,
  storeId: string,
): PendingStoreDraft | null {
  const raw = sessionStorage.getItem(storageKey(staffAccountId, storeId));
  if (raw === null) return null;
  if (raw.length > 16000) throw new Error('待确认的商品草稿记录无效，请联系管理员核对');
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object') throw new Error('INVALID');
    const { requestKey, input } = record as Record<string, unknown>;
    if (typeof requestKey !== 'string' || !uuid.test(requestKey)) throw new Error('INVALID');
    const parsed = canonicalInput(input as AdminProductCreateInput);
    if (JSON.stringify(parsed) !== JSON.stringify(input)) throw new Error('INVALID');
    return { requestKey, input: parsed };
  } catch {
    throw new Error('待确认的商品草稿记录无效，请联系管理员核对');
  }
}

export function reserveStoreDraftRequest(
  staffAccountId: string,
  storeId: string,
  input: AdminProductCreateInput,
): PendingStoreDraft {
  const canonical = canonicalInput(input);
  const existing = pendingStoreDraft(staffAccountId, storeId);
  if (existing) {
    if (JSON.stringify(existing.input) !== JSON.stringify(canonical))
      throw new Error('上次商品草稿创建未确认，请恢复原表单内容后使用同一请求重试');
    return existing;
  }
  const requestKey = crypto.randomUUID();
  if (!uuid.test(requestKey)) throw new Error('无法生成可靠的草稿请求键');
  const pending = { requestKey, input: canonical };
  sessionStorage.setItem(storageKey(staffAccountId, storeId), JSON.stringify(pending));
  // Fail closed if storage did not retain the request key.
  if (pendingStoreDraft(staffAccountId, storeId)?.requestKey !== requestKey)
    throw new Error('草稿请求保存失败，请检查浏览器会话存储');
  return pending;
}

export function clearStoreDraftRequest(
  staffAccountId: string,
  storeId: string,
  requestKey: string,
): void {
  const stored = pendingStoreDraft(staffAccountId, storeId);
  if (!stored) return;
  if (stored.requestKey !== requestKey) throw new Error('商品草稿请求键发生冲突，请停止操作');
  sessionStorage.removeItem(storageKey(staffAccountId, storeId));
}
