import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaffMeResponse } from '@xiaohai/contracts';
import { MeipingPreflightManager } from './meiping-preflight-manager';
import { CorrectionProposalReadOnly } from './meiping-review-manager';
import type { ReviewItem } from './meiping-review-api';
import { visibleAdminModules } from './mock-data';

function render(permissions: string[]) {
  return renderToStaticMarkup(
    <MeipingPreflightManager token="test-session" me={{ permissions } as StaffMeResponse} />,
  );
}

describe('independent correction review entrance', () => {
  it('exposes the Meiping navigation for a dedicated correction reviewer without inventory permissions', () => {
    const modules = visibleAdminModules(['stores.read', 'meiping.correction.review']);
    expect(modules.map((item) => item.key)).toContain('meiping');
    expect(modules.map((item) => item.key)).not.toContain('inventory');
  });

  it('does not display file upload or preflight actions for a read-only independent reviewer', () => {
    const html = render(['stores.read', 'meiping.correction.review']);
    expect(html).toContain('美萍纠错建议独立复核');
    expect(html).toContain('授权门店');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('开始只读预检查');
    expect(html).not.toContain('权限不足');
  });

  it('preserves the original preflight upload for an editor', () => {
    const html = render(['stores.read', 'inventory.receive', 'inventory.stocktake']);
    expect(html).toContain('type="file"');
    expect(html).toContain('开始只读预检查');
  });

  it('hides the Meiping navigation and refuses access without read or edit privileges', () => {
    expect(visibleAdminModules(['stores.read']).map((item) => item.key)).not.toContain('meiping');
    expect(render(['stores.read'])).toContain('权限不足');
  });
  it('shows a read-only comparison of exact proposed fields and the submitter reason', () => {
    const item: ReviewItem = {
      sourceRowNumber: 5,
      disposition: 'REVIEW',
      sourceIdentifiers: {
        bookCode: 'PR148-BOOK-004',
        internalCode: null,
        barcode: 'PR148-DUP-001',
        isbn: null,
      },
      normalized: {
        title: '虚拟测试图书：重复条码甲',
        author: '测试作者甲',
        publisher: 'PR148 测试出版社',
        priceMinor: 2500,
      },
      issueCodes: ['BARCODE_CONFLICT'],
      saleBlocked: false,
      decision: {
        sourceRowNumber: 5,
        action: 'EXCLUDE',
        countedQuantity: null,
        reason: '等待人工核对',
        version: 2,
        updatedAt: '2026-10-21T00:00:00Z',
      },
      correction: {
        sourceRowNumber: 5,
        version: 3,
        proposedFields: { barcode: 'PR153-NEW-003' },
        reason: '重新核对条码，提交第三版人工纠错建议',
        updatedAt: '2026-10-21T00:00:00Z',
      },
      correctionReview: null,
    };
    const html = renderToStaticMarkup(<CorrectionProposalReadOnly item={item} />);
    expect(html).toContain('版本 3（只读）');
    expect(html).toContain('PR148-DUP-001');
    expect(html).toContain('PR153-NEW-003');
    expect(html).toContain('重新核对条码，提交第三版人工纠错建议');
    expect(html).toContain('采纳建议不代表消除源文件冲突或正式入库');
    expect(html).not.toContain('提交独立复核结果');
    expect(html).not.toContain('建议：undefined');

    const empty = renderToStaticMarkup(
      <CorrectionProposalReadOnly item={{ ...item, correction: null }} />,
    );
    expect(empty).toBe('');
  });

});
