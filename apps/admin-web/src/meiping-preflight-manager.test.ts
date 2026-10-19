import { describe, expect, it } from 'vitest';
import { filterMeipingRows, issueSummary } from './meiping-preflight-manager';
import type { MeipingPreflightRow } from './meiping-preflight-api';

const row = (
  sourceRowNumber: number,
  issues: MeipingPreflightRow['issues'],
): MeipingPreflightRow => ({
  sourceRowNumber,
  sourceCategory: '少儿',
  sourceCategoryType: 'BOOK',
  sourceIdentifiers: {
    bookCode: `B-${sourceRowNumber}`,
    internalCode: null,
    barcode: null,
    isbn: null,
  },
  normalized: {
    title: `测试书 ${sourceRowNumber}`,
    author: null,
    publisher: null,
    priceMinor: 1000,
  },
  plannedInventory: 1,
  inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE',
  matchStatus: 'UNMATCHED_REVIEW',
  disposition: 'CREATE_CANDIDATE',
  issues,
});

describe('Meiping preflight presentation helpers', () => {
  it('filters warning, error, and issue code without changing source rows', () => {
    const rows = [
      row(2, [
        { sourceRowNumber: 2, code: 'MISSING_AUTHOR', severity: 'WARNING', message: 'missing' },
      ]),
      row(3, [{ sourceRowNumber: 3, code: 'ZERO_PRICE', severity: 'ERROR', message: 'zero' }]),
      row(4, []),
    ];
    expect(filterMeipingRows(rows, 'WARNING').map((item) => item.sourceRowNumber)).toEqual([2]);
    expect(filterMeipingRows(rows, 'ERROR').map((item) => item.sourceRowNumber)).toEqual([3]);
    expect(filterMeipingRows(rows, 'ZERO_PRICE').map((item) => item.sourceRowNumber)).toEqual([3]);
    expect(filterMeipingRows(rows, 'ALL')).toBe(rows);
  });

  it('summarizes issue categories and keeps the planned stock assumption explicit', () => {
    const rows = [
      row(2, [
        {
          sourceRowNumber: 2,
          code: 'DUPLICATE_BARCODE',
          severity: 'WARNING',
          message: 'duplicate',
        },
      ]),
      row(3, [
        {
          sourceRowNumber: 3,
          code: 'DUPLICATE_BARCODE',
          severity: 'WARNING',
          message: 'duplicate',
        },
        { sourceRowNumber: 3, code: 'ZERO_PRICE', severity: 'ERROR', message: 'zero' },
      ]),
    ];
    expect(issueSummary(rows)).toEqual([
      { code: 'DUPLICATE_BARCODE', count: 2, severity: 'WARNING' },
      { code: 'ZERO_PRICE', count: 1, severity: 'ERROR' },
    ]);
    expect(
      rows.every(
        (item) =>
          item.plannedInventory === 1 && item.inventoryBasis === 'ASSUMED_PENDING_STOCKTAKE',
      ),
    ).toBe(true);
  });
});
