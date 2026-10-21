import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MeipingReviewPanel,
  StoreIndependentReview,
  meipingStorePermissions,
} from './meiping-review-panel';
import {
  correctionProposalInput,
  correctionVerdictInput,
  reviewDecisionInput,
  reviewDecisionConfirmation,
  reviewDecisionIsUnchanged,
} from './meiping-review-input';
import type { ReviewItem } from './meiping-review-api';

const checksum = 'a'.repeat(64);
const item: ReviewItem = {
  sourceRowNumber: 5,
  disposition: 'DUPLICATE',
  sourceIdentifiers: {
    bookCode: 'BOOK-5',
    internalCode: null,
    barcode: 'PR148-DUP-001',
    isbn: null,
  },
  normalized: { title: '重复条码甲', author: '作者甲', publisher: '测试出版社', priceMinor: 3300 },
  issueCodes: ['DUPLICATE_BARCODE'],
  saleBlocked: true,
  decision: {
    sourceRowNumber: 5,
    action: 'EXCLUDE',
    countedQuantity: null,
    reason: '人工核对',
    version: 2,
    updatedAt: '2026-10-21T00:00:00Z',
  },
  correction: {
    sourceRowNumber: 5,
    proposedFields: { barcode: 'PR153-NEW-004' },
    reason: '门店提出条码更正',
    version: 4,
    updatedAt: '2026-10-21T00:00:00Z',
  },
  correctionReview: null,
};

describe('Store Web Meiping review boundaries', () => {
  it('separates original editor rights, dedicated reviewer rights and visibility', () => {
    expect(meipingStorePermissions(['meiping.correction.review'])).toEqual({
      canRead: true,
      canEdit: false,
      canReview: true,
    });
    expect(meipingStorePermissions(['inventory.receive', 'inventory.stocktake'])).toEqual({
      canRead: true,
      canEdit: true,
      canReview: false,
    });
    expect(meipingStorePermissions(['inventory.receive'])).toEqual({
      canRead: false,
      canEdit: false,
      canReview: false,
    });
  });

  it('rejects an unselected verdict and requires a reason', () => {
    expect(correctionVerdictInput(checksum, 4, '', '理由')).toMatch('请主动选择');
    expect(correctionVerdictInput(checksum, 4, 'REJECTED', '')).toMatch('请填写');
    expect(correctionVerdictInput(checksum, 4, 'ACCEPTED', '  人工核验完成  ')).toEqual({
      expectedChecksum: checksum,
      expectedCorrectionVersion: 4,
      verdict: 'ACCEPTED',
      reason: '人工核验完成',
    });
    expect(correctionVerdictInput(checksum, 0, 'ACCEPTED', '理由')).toMatch('版本无效');
  });

  it('shows original and proposed fields before an irreversible verdict without defaulting to reject', () => {
    const html = renderToStaticMarkup(
      <StoreIndependentReview
        item={item}
        checksum={checksum}
        enabled
        disabled={false}
        onSubmit={() => Promise.resolve()}
      />,
    );
    expect(html).toContain('版本 4');
    expect(html).toContain('PR148-DUP-001');
    expect(html).toContain('PR153-NEW-004');
    expect(html).toContain('门店提出条码更正');
    expect(html).toContain('请选择，不默认采纳或驳回');
    expect(html).toContain('不可撤销');
    expect(html).not.toContain('selected="" value="REJECTED"');
  });

  it('renders approved/rejected verdicts as immutable and allows reviewer-only UI without edit forms', () => {
    const existing = renderToStaticMarkup(
      <StoreIndependentReview
        item={{
          ...item,
          correctionReview: {
            sourceRowNumber: 5,
            correctionVersion: 4,
            verdict: 'REJECTED',
            reason: '证据不足',
            reviewedAt: '2026-10-21T01:00:00Z',
          },
        }}
        checksum={checksum}
        enabled
        disabled={false}
        onSubmit={() => Promise.resolve()}
      />,
    );
    expect(existing).toContain('驳回建议');
    expect(existing).not.toContain('<select');
    const reviewer = renderToStaticMarkup(
      <MeipingReviewPanel
        token="mock-session"
        storeId="11111111-1111-4111-8111-111111111111"
        permissions={['stores.read', 'meiping.correction.review']}
      />,
    );
    expect(reviewer).toContain('一次性迁移');
    expect(reviewer).not.toContain('保存纠错建议');
  });


  it('requires an explicit confirmation with the old/new version for a changed original decision', () => {
    const updated = reviewDecisionInput(item, 'EXCLUDE', '', '等待人工核对111', checksum);
    expect(typeof updated).not.toBe('string');
    if (typeof updated === 'string') throw new Error(updated);
    expect(reviewDecisionIsUnchanged(item, updated)).toBe(false);
    const confirmation = reviewDecisionConfirmation(item, updated);
    expect(confirmation).toContain('源行 5');
    expect(confirmation).toContain('版本 2 更新为版本 3');
    expect(confirmation).toContain('等待人工核对111');
    expect(confirmation).toContain('不会创建正式商品或改变库存');

    const initial = reviewDecisionConfirmation({ ...item, decision: null }, {
      ...updated,
      expectedVersion: 0,
    });
    expect(initial).toContain('首次保存为版本 1');
  });

  it('does not submit an unchanged original decision as another version', () => {
    const unchanged = reviewDecisionInput(item, 'EXCLUDE', '', ' 人工核对 ', checksum);
    expect(typeof unchanged).not.toBe('string');
    if (typeof unchanged === 'string') throw new Error(unchanged);
    expect(reviewDecisionIsUnchanged(item, unchanged)).toBe(true);
    const changedAction = reviewDecisionInput(
      { ...item, disposition: 'CREATE_CANDIDATE' }, 'CREATE_DRAFT', '3', '', checksum,
    );
    expect(typeof changedAction).not.toBe('string');
    if (typeof changedAction === 'string') throw new Error(changedAction);
    expect(reviewDecisionIsUnchanged(item, changedAction)).toBe(false);
    const uninitialized = { ...item, decision: null };
    expect(reviewDecisionIsUnchanged(uninitialized, unchanged)).toBe(false);
  });

  it('never lets a blocked duplicate barcode create a draft candidate', () => {
    expect(reviewDecisionInput(item, 'CREATE_DRAFT', '3', '', checksum)).toMatch('不能直接');
    const proposed = correctionProposalInput(
      item,
      {
        title: '',
        author: '',
        publisher: '',
        barcode: 'PR153-NEW-004',
        priceYuan: '',
      },
      '检查源行',
      checksum,
    );
    expect(proposed).toMatchObject({
      expectedVersion: 4,
      proposedFields: { barcode: 'PR153-NEW-004' },
    });
  });
});
