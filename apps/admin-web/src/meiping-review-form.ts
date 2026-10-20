import type { ReviewDecisionInput, ReviewItem } from './meiping-review-api';

export function reviewDecisionInput(
  row: ReviewItem, action: 'CREATE_DRAFT' | 'EXCLUDE',
  quantity: string, reason: string, checksum: string,
): ReviewDecisionInput | string {
  const common = {
    sourceRowNumber: row.sourceRowNumber,
    expectedVersion: row.decision?.version ?? 0,
    expectedChecksum: checksum,
  };
  if (!/^[a-f0-9]{64}$/i.test(checksum)) return '文件校验值无效，请重新建立审核草稿。';
  if (action === 'CREATE_DRAFT') {
    if (row.disposition !== 'CREATE_CANDIDATE') {
      return '该商品存在匹配或阻断问题，当前不能直接建立商品草稿。';
    }
    if (!/^\d+$/.test(quantity.trim())) return '请填写人工盘点数量（非负整数，0 表示无库存）。';
    const countedQuantity = Number(quantity.trim());
    if (!Number.isSafeInteger(countedQuantity) || countedQuantity > 2147483647) {
      return '盘点数量超出允许范围。';
    }
    return { ...common, action, countedQuantity };
  }
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) return '排除原因必须填写，最多 500 字。';
  return { ...common, action, reason: trimmed };
}

export function reviewApiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败，请检查网络后重试。';
  if (error.message === 'CONFLICT') return '审核记录已更新或存在冲突，请刷新后重新核对。';
  if (error.message === 'NOT_FOUND') return '该审核会话不存在，请重新上传 Excel 建立草稿。';
  if (error.message === 'STAFF_AUTHENTICATION_REQUIRED') return '登录状态已失效，请重新登录。';
  if (error.message === 'STAFF_FORBIDDEN' || error.message === 'FORBIDDEN') {
    return '当前账号没有此门店的审核权限。';
  }
  if (error.message.startsWith('INVALID_') || error.message === 'REVIEW_PAGE_CONTEXT_MISMATCH') {
    return '审核服务返回的数据异常，请刷新或联系开发人员。';
  }
  return '操作失败，请检查文件、门店权限或网络后重试。';
}
