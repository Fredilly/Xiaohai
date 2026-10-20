import { describe, expect, it } from 'vitest';
import { reviewDecisionInput } from './meiping-review-form';
import { correctionProposalInput } from './meiping-review-correction-form';
import { filterReviewPage } from './meiping-review-manager';
import type { ReviewItem } from './meiping-review-api';

const checksum = 'a'.repeat(64);
const candidate: ReviewItem = {
  sourceRowNumber: 2,
  disposition: 'CREATE_CANDIDATE',
  sourceIdentifiers: { bookCode: 'S-2', internalCode: null, barcode: '123', isbn: null },
  normalized: { title: '小海故事', author: null, publisher: null, priceMinor: 0 },
  issueCodes: ['AUTHOR_MISSING', 'ZERO_PRICE'],
  saleBlocked: true,
  decision: null,
};

describe('Meiping review form safety checks', () => {
  it('requires explicit user-entered quantity and permits verified zero', () => {
    expect(reviewDecisionInput(candidate, 'CREATE_DRAFT', '', '', checksum)).toMatch('请填写');
    expect(reviewDecisionInput(candidate, 'CREATE_DRAFT', '-1', '', checksum)).toMatch('请填写');
    expect(reviewDecisionInput(candidate, 'CREATE_DRAFT', '2.5', '', checksum)).toMatch('请填写');
    expect(reviewDecisionInput(candidate, 'CREATE_DRAFT', '2147483648', '', checksum)).toMatch(
      '超出',
    );
    expect(reviewDecisionInput(candidate, 'CREATE_DRAFT', '0', '', checksum)).toEqual({
      sourceRowNumber: 2,
      action: 'CREATE_DRAFT',
      countedQuantity: 0,
      expectedVersion: 0,
      expectedChecksum: checksum,
    });
  });

  it('blocks attempted candidate creation on conflicted rows', () => {
    const blocked = { ...candidate, disposition: 'REVIEW' as const };
    expect(reviewDecisionInput(blocked, 'CREATE_DRAFT', '1', '', checksum)).toMatch(
      '不能直接建立商品草稿',
    );
    expect(reviewDecisionInput(blocked, 'EXCLUDE', '', '', checksum)).toMatch('排除原因');
    expect(reviewDecisionInput(blocked, 'EXCLUDE', '', '  条码待核对  ', checksum)).toEqual({
      sourceRowNumber: 2,
      action: 'EXCLUDE',
      reason: '条码待核对',
      expectedVersion: 0,
      expectedChecksum: checksum,
    });
  });

  it('uses the existing version on edits and does not confuse per-page progress with global review', () => {
    const saved: ReviewItem = {
      ...candidate,
      decision: {
        sourceRowNumber: 2,
        action: 'EXCLUDE',
        countedQuantity: null,
        reason: '原始数据有误',
        version: 5,
        updatedAt: '2026-10-20T00:00:00Z',
      },
    };
    expect(reviewDecisionInput(saved, 'CREATE_DRAFT', '2', '', checksum)).toMatchObject({
      expectedVersion: 5,
      countedQuantity: 2,
    });
    expect(filterReviewPage([candidate, saved], 'UNDONE')).toEqual([candidate]);
    expect(filterReviewPage([candidate, saved], 'SAVED')).toEqual([saved]);
    expect(
      filterReviewPage([candidate, { ...candidate, disposition: 'REVIEW' }], 'BLOCKED'),
    ).toHaveLength(1);
  });
});

describe('Meiping correction proposals', () => {
  const empty = { title: '', author: '', publisher: '', barcode: '', priceYuan: '' };
  it('needs a changed field and a reason, and accepts zero-price as unverified', () => {
    expect(correctionProposalInput(candidate, empty, '人工复核', checksum)).toMatch('至少填写');
    expect(correctionProposalInput(candidate, { ...empty, author: '建议作者' }, '', checksum))
      .toMatch('纠错原因');
    expect(correctionProposalInput(candidate, { ...empty, priceYuan: '0' }, '核对价格', checksum))
      .toEqual({
        expectedChecksum: checksum, expectedVersion: 0,
        proposedFields: { priceMinor: 0 }, reason: '核对价格',
      });
    expect(correctionProposalInput(candidate, { ...empty, priceYuan: '12.345' }, '核对', checksum))
      .toMatch('最多两位');
  });
  it('validates barcode proposals but never marks rows eligible for auto import', () => {
    expect(correctionProposalInput(candidate, { ...empty, barcode: '=FORMULA' }, '条码有误', checksum))
      .toMatch('条码建议');
    const input = correctionProposalInput(candidate, { ...empty, barcode: 'PR148-NEW-100' }, '建议纸书核对', checksum);
    expect(input).toMatchObject({
      proposedFields: { barcode: 'PR148-NEW-100' },
      reason: '建议纸书核对',
    });
    const previous: ReviewItem = {
      ...candidate, disposition: 'REVIEW',
      correction: {
        sourceRowNumber: 2, proposedFields: { author: '甲' }, reason: '待核验',
        version: 3, updatedAt: '2026-10-20T00:00:00Z',
      },
    };
    expect(correctionProposalInput(previous, { ...empty, author: '乙' }, '复核', checksum))
      .toMatchObject({ expectedVersion: 3 });
    expect(previous.disposition).toBe('REVIEW');
  });
});
