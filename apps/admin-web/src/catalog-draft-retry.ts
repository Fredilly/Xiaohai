import {
  adminProductCreateInputSchema,
  type AdminProductCreateInput,
} from '@xiaohai/contracts/commerce';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type PendingHqDraft = { requestKey: string; input: AdminProductCreateInput };

function key(staffAccountId: string) {
  if (!uuid.test(staffAccountId)) throw new Error('总部商品草稿账号上下文无效');
  return `xiaohai.hq.catalog.pending.${staffAccountId.toLowerCase()}`;
}

function inputForReplay(input: AdminProductCreateInput) {
  const parsed = adminProductCreateInputSchema.parse(input);
  if (parsed.status !== 'DRAFT' || parsed.sku.availableForSale)
    throw new Error('新商品草稿不能直接公开上架或销售');
  return parsed;
}

export function pendingHqDraft(staffAccountId: string): PendingHqDraft | null {
  const raw = sessionStorage.getItem(key(staffAccountId));
  if (raw === null) return null;
  if (raw.length > 16000) throw new Error('总部待确认商品草稿记录无效');
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== 'object') throw new Error('INVALID');
    const { requestKey, input } = record as Record<string, unknown>;
    if (typeof requestKey !== 'string' || !uuid.test(requestKey)) throw new Error('INVALID');
    const parsed = inputForReplay(input as AdminProductCreateInput);
    if (JSON.stringify(parsed) !== JSON.stringify(input)) throw new Error('INVALID');
    return { requestKey, input: parsed };
  } catch {
    throw new Error('总部待确认商品草稿记录无效');
  }
}

export function reserveHqDraft(staffAccountId: string, input: AdminProductCreateInput) {
  const canonical = inputForReplay(input);
  const previous = pendingHqDraft(staffAccountId);
  if (previous) {
    if (JSON.stringify(previous.input) !== JSON.stringify(canonical))
      throw new Error('上次总部草稿创建结果未确认，请恢复原内容后使用原请求重试');
    return previous;
  }
  const requestKey = crypto.randomUUID();
  if (!uuid.test(requestKey)) throw new Error('无法生成总部草稿请求键');
  const pending = { requestKey, input: canonical };
  sessionStorage.setItem(key(staffAccountId), JSON.stringify(pending));
  if (pendingHqDraft(staffAccountId)?.requestKey !== requestKey)
    throw new Error('总部商品草稿请求保存失败');
  return pending;
}

export function clearHqDraft(staffAccountId: string, requestKey: string) {
  const previous = pendingHqDraft(staffAccountId);
  if (!previous) return;
  if (previous.requestKey !== requestKey) throw new Error('总部商品草稿请求键发生冲突');
  sessionStorage.removeItem(key(staffAccountId));
}
