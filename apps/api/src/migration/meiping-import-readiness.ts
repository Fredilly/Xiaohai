import type { MeipingPreflightReport, MeipingPreflightRow } from './meiping-preflight.js';

export type MeipingReviewDecision =
  | { sourceRowNumber: number; action: 'CREATE_DRAFT'; countedQuantity: number }
  | { sourceRowNumber: number; action: 'EXCLUDE'; reason: string };

export type MeipingReviewIssue = { code: string; sourceRowNumber?: number };

export type MeipingDraftRow = {
  sourceRowNumber: number;
  sourceIdentifiers: MeipingPreflightRow['sourceIdentifiers'];
  title: string;
  author: string | null;
  publisher: string | null;
  priceMinor: number;
  countedQuantity: number;
  productStatus: 'DRAFT';
  availableForSale: false;
  saleBlocked: boolean;
};

export type MeipingReviewPlan = {
  status: 'NEEDS_REVIEW' | 'REVIEW_INPUT_COMPLETE';
  sourceChecksum: string | null;
  storeId: string;
  issues: MeipingReviewIssue[];
  draftCatalogRows: MeipingDraftRow[];
  excludedRowNumbers: number[];
  totalRows: number;
  decidedRows: number;
  countedQuantityTotal: number | null;
  requiresAuthenticatedApproval: true;
  mayWriteCatalogOrInventory: false;
};

const MAX_INTEGER = 2_147_483_647;
const SHA256 = /^[a-f\d]{64}$/i;

function canPlanDraft(row: MeipingPreflightRow): boolean {
  const price = row.normalized.priceMinor;
  return (
    row.disposition === 'CREATE_CANDIDATE' &&
    row.sourceCategoryType === 'BOOK' &&
    row.matchStatus === 'UNMATCHED_REVIEW' &&
    row.blockingIssues.length === 0 &&
    !row.issues.some((issue) => issue.severity === 'ERROR') &&
    Boolean(row.normalized.title) &&
    price !== null &&
    Number.isInteger(price) &&
    price >= 0 &&
    price <= MAX_INTEGER &&
    Object.values(row.sourceIdentifiers).some(Boolean)
  );
}

/**
 * Pure planning gate only: no DB connection, writes, approved inventory or audit.
 * Every source row needs an explicit decision; the XLS assumed stock of one is
 * NEVER substituted for a physical count. Caller-supplied decisions are not
 * authenticated approvals and must not be used directly by any import writer.
 */
export function buildMeipingReviewPlan(
  report: MeipingPreflightReport,
  input: {
    storeId: string;
    expectedChecksum: string;
    decisions: MeipingReviewDecision[];
  },
): MeipingReviewPlan {
  const issues: MeipingReviewIssue[] = [];
  const checksum = report.sourceChecksum ?? null;
  if (!checksum || !SHA256.test(checksum)) {
    issues.push({ code: 'MISSING_OR_INVALID_SOURCE_CHECKSUM' });
  }
  if (!SHA256.test(input.expectedChecksum) || checksum !== input.expectedChecksum) {
    issues.push({ code: 'SOURCE_CHECKSUM_MISMATCH' });
  }
  if (!input.storeId || report.sourceStoreId !== input.storeId) {
    issues.push({ code: 'STORE_MISMATCH' });
  }
  if (report.totalRows < 1 || report.rows.length !== report.totalRows) {
    issues.push({ code: 'REPORT_ROW_COUNT_MISMATCH' });
  }
  if (report.inventoryApproval !== 'PENDING_ADMIN_REVIEW') {
    issues.push({ code: 'UNEXPECTED_INVENTORY_APPROVAL_STATE' });
  }

  const rows = new Map<number, MeipingPreflightRow>();
  for (const row of report.rows) {
    if (!Number.isSafeInteger(row.sourceRowNumber) || row.sourceRowNumber < 1) {
      issues.push({ code: 'INVALID_SOURCE_ROW_NUMBER' });
    } else if (rows.has(row.sourceRowNumber)) {
      issues.push({ code: 'DUPLICATE_SOURCE_ROW', sourceRowNumber: row.sourceRowNumber });
    } else {
      rows.set(row.sourceRowNumber, row);
    }
  }

  const decisions = new Map<number, MeipingReviewDecision>();
  for (const decision of input.decisions) {
    if (!Number.isSafeInteger(decision.sourceRowNumber) || decision.sourceRowNumber < 1) {
      issues.push({ code: 'INVALID_DECISION_ROW_NUMBER' });
    } else if (!rows.has(decision.sourceRowNumber)) {
      issues.push({ code: 'UNKNOWN_DECISION_ROW', sourceRowNumber: decision.sourceRowNumber });
    } else if (decisions.has(decision.sourceRowNumber)) {
      issues.push({ code: 'DUPLICATE_DECISION', sourceRowNumber: decision.sourceRowNumber });
    } else {
      decisions.set(decision.sourceRowNumber, decision);
    }
  }

  const draftCatalogRows: MeipingDraftRow[] = [];
  const excludedRowNumbers: number[] = [];
  for (const [sourceRowNumber, row] of rows) {
    const decision = decisions.get(sourceRowNumber);
    if (!decision) {
      issues.push({ code: 'DECISION_REQUIRED', sourceRowNumber });
      continue;
    }
    if (decision.action === 'EXCLUDE') {
      if (!decision.reason.trim()) {
        issues.push({ code: 'EXCLUSION_REASON_REQUIRED', sourceRowNumber });
      } else {
        excludedRowNumbers.push(sourceRowNumber);
      }
      continue;
    }
    if (decision.action !== 'CREATE_DRAFT') {
      issues.push({ code: 'INVALID_DECISION_ACTION', sourceRowNumber });
      continue;
    }
    if (!canPlanDraft(row)) {
      issues.push({ code: 'ROW_REQUIRES_MANUAL_RESOLUTION', sourceRowNumber });
      continue;
    }
    if (
      !Number.isSafeInteger(decision.countedQuantity) ||
      decision.countedQuantity < 0 ||
      decision.countedQuantity > MAX_INTEGER
    ) {
      issues.push({ code: 'PHYSICAL_COUNT_REQUIRED', sourceRowNumber });
      continue;
    }
    draftCatalogRows.push({
      sourceRowNumber,
      sourceIdentifiers: row.sourceIdentifiers,
      title: row.normalized.title!,
      author: row.normalized.author,
      publisher: row.normalized.publisher,
      priceMinor: row.normalized.priceMinor!,
      countedQuantity: decision.countedQuantity,
      productStatus: 'DRAFT',
      availableForSale: false,
      saleBlocked: row.saleBlocked.length > 0 || row.normalized.priceMinor === 0,
    });
  }
  const quantity = draftCatalogRows.reduce((sum, row) => sum + row.countedQuantity, 0);
  if (!Number.isSafeInteger(quantity)) issues.push({ code: 'COUNTED_QUANTITY_OVERFLOW' });
  const complete = issues.length === 0;
  return {
    status: complete ? 'REVIEW_INPUT_COMPLETE' : 'NEEDS_REVIEW',
    sourceChecksum: checksum,
    storeId: report.sourceStoreId,
    issues,
    draftCatalogRows,
    excludedRowNumbers,
    totalRows: report.totalRows,
    decidedRows: decisions.size,
    countedQuantityTotal: complete ? quantity : null,
    requiresAuthenticatedApproval: true,
    mayWriteCatalogOrInventory: false,
  };
}
