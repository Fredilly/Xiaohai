/** UI-only labels for historical Meiping source dispositions and blocking/warning codes.
 * Original codes remain unchanged in API/DB and are available as hover tooltips.
 */
import type { ReviewItem } from './meiping-review-api';

const dispositions: Record<ReviewItem['disposition'], string> = {
  MATCHED: '已匹配现有图书（待确认）',
  CREATE_CANDIDATE: '可建立商品草稿（不入库）',
  REVIEW: '需要人工核对',
  REJECTED: '无法自动处理',
  DUPLICATE: '疑似重复记录',
};

const issues: Record<string, string> = {
  IDENTIFIER_REVIEW: '缺少可核实的商品编号',
  FORMULA_ROW_REVIEW: '原始表格含公式，需核实',
  ZERO_PRICE: '价格为零，不能正常销售',
  NON_BOOK_CATEGORY: '原始分类不是图书',
  CATEGORY_UNKNOWN: '原始商品分类不明确',
  DUPLICATE_BARCODE: '源文件中存在重复条码',
  BARCODE_CONFLICT: '相同条码对应不同书名或价格',
  AUTHOR_MISSING: '作者信息缺失',
  PUBLISHER_MISSING: '出版社信息缺失',
  TITLE_REQUIRED: '书名缺失',
  PRICE_REQUIRED: '价格缺失',
  PRICE_INVALID: '价格格式不正确',
  INVENTORY_REQUIRED: '原始库存数量缺失',
  INVENTORY_INVALID: '原始库存数量格式不正确',
  INVENTORY_NEGATIVE: '原始库存数量为负数',
  MISSING_COLUMN_TITLE: '原始表格缺少书名列',
  MISSING_COLUMN_PRICE: '原始表格缺少价格列',
  DUPLICATE_ROW: '源文件中存在重复记录',
  BOOK_CODE_CONFLICT: '图书编码存在冲突',
  INTERNAL_CODE_CONFLICT: '内部商品编号存在冲突',
};

export function meipingDispositionLabel(code: ReviewItem['disposition']): string {
  return dispositions[code];
}

export function meipingIssueLabel(code: string): string {
  return issues[code] ?? '其他需人工核实的问题';
}

export function meipingSessionStatusLabel(status: 'DRAFT'): string {
  return status === 'DRAFT' ? '审核草稿（未正式入库）' : '状态待确认';
}
