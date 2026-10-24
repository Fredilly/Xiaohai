import type { ReviewCorrectionInput, ReviewItem } from './meiping-review-api';

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
