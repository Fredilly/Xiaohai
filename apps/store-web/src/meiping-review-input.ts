import type { ReviewCorrectionInput, ReviewDecisionInput, CorrectionReviewInput, ReviewItem } from './meiping-review-api';

/** A proposed fix is separate from the original Excel record and never activates sale/import. */
export function correctionProposalInput(
  item: ReviewItem,
  values: { title: string; author: string; publisher: string; barcode: string; priceYuan: string },
  reason: string,
  checksum: string,
): ReviewCorrectionInput | string {
  if (!/^[a-f0-9]{64}$/i.test(checksum)) return '源文件校验值无效。';
  const proposedFields: ReviewCorrectionInput['proposedFields'] = {};
  const lengths = { title: 200, author: 160, publisher: 160, barcode: 64 };
  for (const key of ['title', 'author', 'publisher', 'barcode'] as const) {
    const value = values[key].trim();
    if (!value) continue;
    if (value.length > lengths[key]) return key + ' 超出长度限制。';
    if (key === 'barcode' && !/^[A-Za-z0-9-]{4,64}$/.test(value)) {
      return '条码建议只能填写 4–64 位字母、数字和连接号。';
    }
    proposedFields[key] = value;
  }
  const price = values.priceYuan.trim();
  if (price) {
    if (!/^\d+(\.\d{1,2})?$/.test(price)) return '建议定价请填写非负金额，最多两位小数。';
    const [yuan, fen = ''] = price.split('.');
    const minor = Number(yuan) * 100 + Number(fen.padEnd(2, '0'));
    if (!Number.isSafeInteger(minor) || minor > 2147483647) {
      return '建议定价超出允许范围。';
    }
    proposedFields.priceMinor = minor;
  }
  if (Object.keys(proposedFields).length === 0) return '请至少填写一项需要纠正的字段。';
  const note = reason.trim();
  if (!note || note.length > 500) return '请填写纠错原因（最多 500 字）。';
  return {
    expectedChecksum: checksum,
    expectedVersion: item.correction?.version ?? 0,
    proposedFields,
    reason: note,
  };
}

export function reviewDecisionInput(
  row: ReviewItem,
  action: 'CREATE_DRAFT' | 'EXCLUDE',
  quantity: string,
  reason: string,
  checksum: string,
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
  if (error.message === 'SELF_REVIEW_FORBIDDEN') {
    return '纠错建议必须由另一名具备独立复核权限的工作人员复核。';
  }
  if (error.message === 'BARCODE_NOT_VERIFIED') {
    return '建议条码仍有冲突或未能通过现有记录校验，不可采纳；请驳回或进一步核对。';
  }
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

/** Deliberately no default verdict: the reviewer must explicitly select one. */
export function correctionVerdictInput(
  expectedChecksum: string,
  expectedCorrectionVersion: number,
  verdict: '' | 'ACCEPTED' | 'REJECTED',
  reason: string,
): CorrectionReviewInput | string {
  if (!/^[a-f0-9]{64}$/i.test(expectedChecksum)) return '源文件校验值无效。';
  if (!Number.isSafeInteger(expectedCorrectionVersion) || expectedCorrectionVersion < 1) {
    return '纠错建议版本无效，请刷新后重试。';
  }
  if (verdict !== 'ACCEPTED' && verdict !== 'REJECTED') {
    return '请主动选择采纳建议或驳回建议，系统不会默认选择。';
  }
  const note = reason.trim();
  if (!note || note.length > 500) return '请填写复核原因（1–500 字）。';
  return { expectedChecksum, expectedCorrectionVersion, verdict, reason: note };
}
