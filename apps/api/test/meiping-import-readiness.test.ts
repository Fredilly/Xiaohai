import { describe, expect, it } from 'vitest';
import {
  buildMeipingReviewPlan,
  type MeipingReviewDecision,
} from '../src/migration/meiping-import-readiness.js';
import type {
  MeipingPreflightReport,
  MeipingPreflightRow,
} from '../src/migration/meiping-preflight.js';

const checksum = 'a'.repeat(64);

function row(
  sourceRowNumber: number,
  overrides: Partial<MeipingPreflightRow> = {},
): MeipingPreflightRow {
  const warning = {
    code: 'AUTHOR_MISSING',
    severity: 'WARNING' as const,
    sourceRowNumber,
    message: '缺少作者',
  };
  return {
    sourceRowNumber,
    rawColumns: {},
    sourceCategory: '图书',
    sourceCategoryType: 'BOOK',
    sourceIdentifiers: {
      bookCode: 'B-' + sourceRowNumber,
      internalCode: null,
      barcode: '6900' + sourceRowNumber,
      isbn: null,
    },
    normalized: { title: '绘本', author: null, publisher: null, priceMinor: 3900 },
    plannedInventory: 1,
    inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE',
    matchStatus: 'UNMATCHED_REVIEW',
    disposition: 'CREATE_CANDIDATE',
    issues: [warning],
    metadataWarnings: [warning],
    blockingIssues: [],
    saleBlocked: [],
    ...overrides,
  };
}

function report(rows: MeipingPreflightRow[]): MeipingPreflightReport {
  return {
    sourceType: 'MEIPING_XLS',
    sourceChecksum: checksum,
    sourceStoreId: 'store-east-test',
    sourceStoreCode: 'TEST-EAST',
    inventoryApproval: 'PENDING_ADMIN_REVIEW',
    totalRows: rows.length,
    matchedRows: 0,
    createCandidateRows: rows.length,
    exceptionRows: 0,
    metadataWarningRows: 0,
    blockingRows: 0,
    saleBlockedRows: 0,
    assumedInventoryRows: rows.length,
    plannedInventoryTotal: rows.length,
    rows,
    exceptionReportCsv: '',
  };
}

function plan(rows: MeipingPreflightRow[], decisions: MeipingReviewDecision[]) {
  return buildMeipingReviewPlan(report(rows), {
    storeId: 'store-east-test',
    expectedChecksum: checksum,
    decisions,
  });
}

describe('Meiping review planning gate: no database writes', () => {
  it('requires individual decisions rather than assuming one unit per Excel row', () => {
    const result = plan([row(2)], []);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.countedQuantityTotal).toBeNull();
    expect(result.issues).toContainEqual({ code: 'DECISION_REQUIRED', sourceRowNumber: 2 });
    expect(result.mayWriteCatalogOrInventory).toBe(false);
  });

  it('allows missing author/publisher in draft only, with a physical count', () => {
    const result = plan(
      [row(2)],
      [{ sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 3 }],
    );
    expect(result.status).toBe('REVIEW_INPUT_COMPLETE');
    expect(result.countedQuantityTotal).toBe(3);
    expect(result.draftCatalogRows[0]).toMatchObject({
      author: null,
      publisher: null,
      productStatus: 'DRAFT',
      availableForSale: false,
      countedQuantity: 3,
    });
    expect(result.requiresAuthenticatedApproval).toBe(true);
    expect(result.mayWriteCatalogOrInventory).toBe(false);
  });

  it('preserves zero-price sale blocking and accepts a verified count of zero', () => {
    const warning = {
      code: 'ZERO_PRICE',
      severity: 'WARNING' as const,
      sourceRowNumber: 2,
      message: '零价',
    };
    const zeroPriceRow = row(2, {
      normalized: { title: '绘本', author: null, publisher: null, priceMinor: 0 },
      issues: [warning],
      saleBlocked: [warning],
    });
    const result = plan(
      [zeroPriceRow],
      [{ sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 0 }],
    );
    expect(result.status).toBe('REVIEW_INPUT_COMPLETE');
    expect(result.draftCatalogRows[0]).toMatchObject({
      saleBlocked: true,
      availableForSale: false,
    });
    expect(result.countedQuantityTotal).toBe(0);
  });

  it('rejects conflict and unknown future errors even if proposed as draft', () => {
    const conflict = {
      code: 'BARCODE_CONFLICT',
      severity: 'ERROR' as const,
      sourceRowNumber: 2,
      message: '冲突',
    };
    const future = { ...conflict, code: 'FUTURE_ERROR' };
    for (const candidate of [
      row(2, { disposition: 'REVIEW', issues: [conflict], blockingIssues: [conflict] }),
      row(2, { issues: [future], blockingIssues: [] }),
    ]) {
      const result = plan(
        [candidate],
        [{ sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 1 }],
      );
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.draftCatalogRows).toHaveLength(0);
      expect(result.issues).toContainEqual({
        code: 'ROW_REQUIRES_MANUAL_RESOLUTION',
        sourceRowNumber: 2,
      });
    }
  });

  it('requires a reason to exclude blocked source rows', () => {
    const blocked = row(3, { disposition: 'REVIEW' });
    const noReason: MeipingReviewDecision = { sourceRowNumber: 3, action: 'EXCLUDE', reason: '' };
    expect(plan([blocked], [noReason]).status).toBe('NEEDS_REVIEW');
    const exclusion: MeipingReviewDecision = {
      sourceRowNumber: 3,
      action: 'EXCLUDE',
      reason: '待人工核对条码',
    };
    const result = plan([blocked], [exclusion]);
    expect(result.status).toBe('REVIEW_INPUT_COMPLETE');
    expect(result.excludedRowNumbers).toEqual([3]);
  });

  it('rejects missing, duplicate, and out-of-file review decisions', () => {
    const result = plan(
      [row(2), row(3)],
      [
        { sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 1 },
        { sourceRowNumber: 2, action: 'EXCLUDE', reason: '重复' },
        { sourceRowNumber: 99, action: 'EXCLUDE', reason: '不存在' },
      ],
    );
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.countedQuantityTotal).toBeNull();
    expect(result.issues.some((issue) => issue.code === 'DECISION_REQUIRED')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_DECISION')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'UNKNOWN_DECISION_ROW')).toBe(true);
  });

  it('does not accept missing, fractional, negative or out-of-range physical counts', () => {
    for (const countedQuantity of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      const proposed = {
        sourceRowNumber: 2,
        action: 'CREATE_DRAFT',
        countedQuantity,
      } as MeipingReviewDecision;
      const result = plan([row(2)], [proposed]);
      expect(result.issues).toContainEqual({
        code: 'PHYSICAL_COUNT_REQUIRED',
        sourceRowNumber: 2,
      });
    }
  });

  it('binds all decisions to a checked store, checksum and unique source rows', () => {
    const result = buildMeipingReviewPlan(report([row(2), row(2)]), {
      storeId: 'wrong-store',
      expectedChecksum: 'b'.repeat(64),
      decisions: [{ sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 4 }],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.issues.some((issue) => issue.code === 'SOURCE_CHECKSUM_MISMATCH')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'STORE_MISMATCH')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_SOURCE_ROW')).toBe(true);
    expect(result.countedQuantityTotal).toBeNull();
  });

  it('refuses automatic creation for already matched ISBNs', () => {
    const result = plan(
      [row(2, { matchStatus: 'MATCHED_BY_EXPLICIT_ISBN', disposition: 'MATCHED' })],
      [{ sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 1 }],
    );
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.draftCatalogRows).toHaveLength(0);
  });
});
