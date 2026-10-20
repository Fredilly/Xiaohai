import { dryRunCanonicalMigration, type MigrationIssue } from './meiping.js';
import { exceptionCsv, type MeipingParsedRow, type MeipingSourceCategory } from './meiping-xls.js';

export type MeipingPreflightIssue = MigrationIssue & { sourceRowNumber: number };

export type MeipingPreflightRow = {
  sourceRowNumber: number;
  rawColumns: Record<string, unknown>;
  sourceCategory: string | null;
  sourceCategoryType: MeipingSourceCategory;
  sourceIdentifiers: {
    bookCode: string | null;
    internalCode: string | null;
    barcode: string | null;
    isbn: string | null;
  };
  normalized: {
    title: string | null;
    author: string | null;
    publisher: string | null;
    priceMinor: number | null;
  };
  plannedInventory: 1;
  inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE';
  matchStatus: 'MATCHED_BY_EXPLICIT_ISBN' | 'UNMATCHED_REVIEW';
  disposition: 'MATCHED' | 'CREATE_CANDIDATE' | 'REVIEW' | 'REJECTED' | 'DUPLICATE';
  issues: MeipingPreflightIssue[];
  metadataWarnings: MeipingPreflightIssue[];
  blockingIssues: MeipingPreflightIssue[];
  saleBlocked: MeipingPreflightIssue[];
};

export type MeipingPreflightReport = {
  sourceType: 'MEIPING_XLS';
  sourceChecksum?: string;
  sourceStoreId: string;
  sourceStoreCode: string;
  inventoryApproval: 'PENDING_ADMIN_REVIEW';
  totalRows: number;
  matchedRows: number;
  createCandidateRows: number;
  exceptionRows: number;
  metadataWarningRows: number;
  blockingRows: number;
  saleBlockedRows: number;
  assumedInventoryRows: number;
  plannedInventoryTotal: number;
  rows: MeipingPreflightRow[];
  exceptionReportCsv: string;
};

function issue(
  sourceRowNumber: number,
  code: string,
  severity: MigrationIssue['severity'],
  message: string,
) {
  return { sourceRowNumber, code, severity, message } satisfies MeipingPreflightIssue;
}

export function buildMeipingPreflight(
  rows: MeipingParsedRow[],
  input: { storeId: string; storeCode: string },
  options: { matchedRowNumbers?: Set<number>; missingMappedFields?: string[] } = {},
): MeipingPreflightReport {
  const canonical = dryRunCanonicalMigration(rows.map((row) => row.canonical));
  const barcodeGroups = new Map<string, MeipingParsedRow[]>();
  for (const row of rows) {
    if (!row.barcode) continue;
    const group = barcodeGroups.get(row.barcode) ?? [];
    group.push(row);
    barcodeGroups.set(row.barcode, group);
  }

  const resultRows = rows.map((sourceRow, index) => {
    const base = canonical.rows[index]!;
    const issues: MeipingPreflightIssue[] = base.issues
      .filter(
        (item) =>
          item.code !== 'IDENTIFIER_REVIEW' ||
          (!sourceRow.barcode && !sourceRow.isbn && !sourceRow.bookCode && !sourceRow.internalCode),
      )
      .map((item) => ({
        ...item,
        sourceRowNumber: sourceRow.sourceRowNumber,
      }));
    for (const code of options.missingMappedFields ?? []) {
      issues.push(issue(sourceRow.sourceRowNumber, code, 'ERROR', '缺少必要字段列，无法可靠映射'));
    }
    if (sourceRow.hasFormula) {
      issues.push(
        issue(
          sourceRow.sourceRowNumber,
          'FORMULA_ROW_REVIEW',
          'WARNING',
          '商品行包含公式，需人工确认解析结果',
        ),
      );
    }
    if (base.normalized.priceMinor === 0) {
      issues.push(
        issue(
          sourceRow.sourceRowNumber,
          'ZERO_PRICE',
          'WARNING',
          '价格为 0，资料可暂存但禁止正常销售',
        ),
      );
    }
    if (sourceRow.sourceCategoryType === 'NON_BOOK') {
      issues.push(
        issue(
          sourceRow.sourceRowNumber,
          'NON_BOOK_CATEGORY',
          'WARNING',
          '原始类别不是图书，不能自动进入图书候选',
        ),
      );
    } else if (sourceRow.sourceCategoryType === 'UNKNOWN') {
      issues.push(
        issue(
          sourceRow.sourceRowNumber,
          'CATEGORY_UNKNOWN',
          'WARNING',
          '原始类别缺失或无法判断，需要人工确认',
        ),
      );
    }
    const group = sourceRow.barcode ? (barcodeGroups.get(sourceRow.barcode) ?? []) : [];
    if (group.length > 1) {
      const signature = JSON.stringify([sourceRow.canonical.title, sourceRow.canonical.price]);
      const signatures = new Set(
        group.map((item) => JSON.stringify([item.canonical.title, item.canonical.price])),
      );
      if (
        group.filter(
          (item) => JSON.stringify([item.canonical.title, item.canonical.price]) === signature,
        ).length > 1
      ) {
        issues.push(
          issue(sourceRow.sourceRowNumber, 'DUPLICATE_BARCODE', 'WARNING', '条码在源文件中重复'),
        );
      }
      if (signatures.size > 1) {
        issues.push(
          issue(
            sourceRow.sourceRowNumber,
            'BARCODE_CONFLICT',
            'ERROR',
            '同一条码对应不同书名或价格',
          ),
        );
      }
    }
    const metadataWarnings = issues.filter((item) =>
      ['AUTHOR_MISSING', 'PUBLISHER_MISSING'].includes(item.code),
    );
    const saleBlocked = issues.filter((item) => item.code === 'ZERO_PRICE');
    const blockingCodes = new Set([
      'TITLE_REQUIRED',
      'IDENTIFIER_REVIEW',
      'PRICE_REQUIRED',
      'PRICE_INVALID',
      'INVENTORY_REQUIRED',
      'INVENTORY_INVALID',
      'INVENTORY_NEGATIVE',
      'MISSING_COLUMN_TITLE',
      'MISSING_COLUMN_PRICE',
      'FORMULA_ROW_REVIEW',
      'NON_BOOK_CATEGORY',
      'CATEGORY_UNKNOWN',
      'DUPLICATE_ROW',
      'DUPLICATE_BARCODE',
      'BARCODE_CONFLICT',
      'BOOK_CODE_CONFLICT',
      'INTERNAL_CODE_CONFLICT',
    ]);
    const blockingIssues = issues.filter((item) => blockingCodes.has(item.code));
    const hasBlockingIssue = blockingIssues.length > 0;
    const disposition =
      sourceRow.sourceCategoryType !== 'BOOK'
        ? 'REVIEW'
        : hasBlockingIssue
          ? base.disposition === 'DUPLICATE'
            ? 'DUPLICATE'
            : 'REVIEW'
          : base.disposition === 'DUPLICATE'
            ? 'DUPLICATE'
            : options.matchedRowNumbers?.has(sourceRow.sourceRowNumber)
              ? 'MATCHED'
              : 'CREATE_CANDIDATE';
    return {
      sourceRowNumber: sourceRow.sourceRowNumber,
      rawColumns: sourceRow.rawColumns,
      sourceCategory: sourceRow.sourceCategory,
      sourceCategoryType: sourceRow.sourceCategoryType,
      sourceIdentifiers: {
        bookCode: sourceRow.bookCode,
        internalCode: sourceRow.internalCode,
        barcode: sourceRow.barcode,
        isbn: sourceRow.isbn,
      },
      normalized: {
        title: base.normalized.title,
        author: base.normalized.author,
        publisher: base.normalized.publisher,
        priceMinor: base.normalized.priceMinor,
      },
      plannedInventory: 1 as const,
      inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE' as const,
      matchStatus: options.matchedRowNumbers?.has(sourceRow.sourceRowNumber)
        ? ('MATCHED_BY_EXPLICIT_ISBN' as const)
        : ('UNMATCHED_REVIEW' as const),
      disposition,
      issues,
      metadataWarnings,
      blockingIssues,
      saleBlocked,
    } satisfies MeipingPreflightRow;
  });
  const exceptions = resultRows.filter(
    (row) =>
      row.blockingIssues.length > 0 || !['CREATE_CANDIDATE', 'MATCHED'].includes(row.disposition),
  );
  return {
    sourceType: 'MEIPING_XLS',
    sourceStoreId: input.storeId,
    sourceStoreCode: input.storeCode,
    inventoryApproval: 'PENDING_ADMIN_REVIEW',
    totalRows: resultRows.length,
    // No external identifier is treated as a canonical SKU match in phase one.
    matchedRows: resultRows.filter((row) => row.disposition === 'MATCHED').length,
    createCandidateRows: resultRows.filter((row) => row.disposition === 'CREATE_CANDIDATE').length,
    exceptionRows: exceptions.length,
    metadataWarningRows: resultRows.filter((row) => row.metadataWarnings.length > 0).length,
    blockingRows: resultRows.filter((row) => row.blockingIssues.length > 0).length,
    saleBlockedRows: resultRows.filter((row) => row.saleBlocked.length > 0).length,
    assumedInventoryRows: resultRows.length,
    plannedInventoryTotal: resultRows.length,
    rows: resultRows,
    exceptionReportCsv: exceptionCsv(
      exceptions.map((row) => ({
        sourceRowNumber: row.sourceRowNumber,
        reasonCodes: row.issues.map((item) => item.code),
        title: row.normalized.title,
        barcode: row.sourceIdentifiers.barcode,
        category: row.sourceCategoryType,
      })),
    ),
  };
}
