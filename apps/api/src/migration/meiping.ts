export type CanonicalMigrationInput = {
  bookCode?: unknown;
  internalCode?: unknown;
  title?: unknown;
  author?: unknown;
  publisher?: unknown;
  price?: unknown;
  inventory?: unknown;
};

export type CanonicalMigrationRecord = {
  bookCode: string | null;
  internalCode: string | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  priceMinor: number | null;
  inventory: number | null;
};

export type MigrationIssue = {
  code: string;
  severity: 'WARNING' | 'ERROR';
  message: string;
};

export type EvaluatedMigrationRow = {
  sourceRowNumber: number;
  raw: CanonicalMigrationInput;
  normalized: CanonicalMigrationRecord;
  issues: MigrationIssue[];
  disposition: 'IMPORTABLE' | 'REVIEW' | 'REJECTED' | 'DUPLICATE';
};

export type DryRunReport = {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateOrConflictRows: number;
  importableRows: number;
  reviewRows: number;
  sourceInventoryTotal: number | null;
  plannedInventoryTotal: number;
  rows: EvaluatedMigrationRow[];
};

const POSTGRES_INTEGER_MIN = -2147483648n;
const POSTGRES_INTEGER_MAX = 2147483647n;

export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

export function parsePriceMinor(value: unknown): number | null {
  const text = normalizeText(value);
  if (text === null) return null;
  const match = /^(?:¥|￥)?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const yuan = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const minor = yuan * 100n + fraction;
  return minor <= POSTGRES_INTEGER_MAX ? Number(minor) : null;
}

export function parseInventory(value: unknown): number | null {
  const text = normalizeText(value);
  if (text === null || !/^-?\d+$/.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed < POSTGRES_INTEGER_MIN || parsed > POSTGRES_INTEGER_MAX) return null;
  return Number(parsed);
}

export function normalizeCanonicalRecord(input: CanonicalMigrationInput): CanonicalMigrationRecord {
  return {
    bookCode: normalizeText(input.bookCode),
    internalCode: normalizeText(input.internalCode),
    title: normalizeText(input.title),
    author: normalizeText(input.author),
    publisher: normalizeText(input.publisher),
    priceMinor: parsePriceMinor(input.price),
    inventory: parseInventory(input.inventory),
  };
}

function baseIssues(
  input: CanonicalMigrationInput,
  record: CanonicalMigrationRecord,
): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  if (!record.title)
    issues.push({ code: 'TITLE_REQUIRED', severity: 'ERROR', message: '图书名字不能为空' });
  if (!record.bookCode && !record.internalCode) {
    issues.push({
      code: 'IDENTIFIER_REVIEW',
      severity: 'WARNING',
      message: '图书编码和自有编号均缺失，需要人工确认',
    });
  }
  if (!record.author)
    issues.push({ code: 'AUTHOR_MISSING', severity: 'WARNING', message: '作者缺失，需要人工确认' });
  if (!record.publisher)
    issues.push({
      code: 'PUBLISHER_MISSING',
      severity: 'WARNING',
      message: '出版社缺失，需要人工确认',
    });
  if (normalizeText(input.price) === null) {
    issues.push({ code: 'PRICE_REQUIRED', severity: 'ERROR', message: '价格不能为空' });
  } else if (record.priceMinor === null) {
    issues.push({
      code: 'PRICE_INVALID',
      severity: 'ERROR',
      message: '价格必须是最多两位小数且可存入 staging integer 的非负十进制金额',
    });
  }
  if (normalizeText(input.inventory) === null) {
    issues.push({ code: 'INVENTORY_REQUIRED', severity: 'ERROR', message: '库存不能为空' });
  } else if (record.inventory === null) {
    issues.push({
      code: 'INVENTORY_INVALID',
      severity: 'ERROR',
      message: '库存必须是可存入 staging integer 的整数',
    });
  } else if (record.inventory < 0) {
    issues.push({ code: 'INVENTORY_NEGATIVE', severity: 'ERROR', message: '库存不能为负数' });
  }
  return issues;
}

function fingerprint(record: CanonicalMigrationRecord): string {
  return JSON.stringify(record);
}

export function dryRunCanonicalMigration(inputs: CanonicalMigrationInput[]): DryRunReport {
  const rows: EvaluatedMigrationRow[] = inputs.map((raw, index) => ({
    sourceRowNumber: index + 1,
    raw,
    normalized: normalizeCanonicalRecord(raw),
    issues: [],
    disposition: 'IMPORTABLE',
  }));
  const seenFingerprint = new Map<string, number>();
  const bookCodes = new Map<string, string>();
  const internalCodes = new Map<string, string>();

  for (const row of rows) {
    row.issues.push(...baseIssues(row.raw, row.normalized));
    const fp = fingerprint(row.normalized);
    const duplicateOf = seenFingerprint.get(fp);
    if (duplicateOf !== undefined) {
      row.issues.push({
        code: 'DUPLICATE_ROW',
        severity: 'WARNING',
        message: `与 source row ${duplicateOf} 完全重复`,
      });
      row.disposition = row.issues.some((issue) => issue.severity === 'ERROR')
        ? 'REJECTED'
        : 'DUPLICATE';
      continue;
    }
    seenFingerprint.set(fp, row.sourceRowNumber);

    for (const [kind, value, index] of [
      ['BOOK_CODE', row.normalized.bookCode, bookCodes],
      ['INTERNAL_CODE', row.normalized.internalCode, internalCodes],
    ] as const) {
      if (!value) continue;
      const previous = index.get(value);
      if (previous && previous !== fp) {
        row.issues.push({
          code: `${kind}_CONFLICT`,
          severity: 'ERROR',
          message: `${kind === 'BOOK_CODE' ? '图书编码' : '自有编号'}与另一条不同记录冲突`,
        });
      } else {
        index.set(value, fp);
      }
    }

    if (row.issues.some((issue) => issue.severity === 'ERROR')) row.disposition = 'REJECTED';
    else if (row.issues.length > 0) row.disposition = 'REVIEW';
  }

  const sourceInventoryValues = inputs.map((input) => parseInventory(input.inventory));
  const sourceInventoryTotal = sourceInventoryValues.every((value) => value !== null)
    ? sourceInventoryValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const plannedInventoryTotal = rows
    .filter((row) => row.disposition === 'IMPORTABLE')
    .reduce((sum, row) => sum + (row.normalized.inventory ?? 0), 0);

  return {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.issues.length === 0).length,
    warningRows: rows.filter((row) => row.issues.some((issue) => issue.severity === 'WARNING'))
      .length,
    errorRows: rows.filter((row) => row.issues.some((issue) => issue.severity === 'ERROR')).length,
    duplicateOrConflictRows: rows.filter((row) =>
      row.issues.some(
        (issue) => issue.code === 'DUPLICATE_ROW' || issue.code.endsWith('_CONFLICT'),
      ),
    ).length,
    importableRows: rows.filter((row) => row.disposition === 'IMPORTABLE').length,
    reviewRows: rows.filter((row) => row.disposition === 'REVIEW' || row.disposition === 'REJECTED')
      .length,
    sourceInventoryTotal,
    plannedInventoryTotal,
    rows,
  };
}

export type ReconciliationInput = {
  sourceRowCount: number;
  stagingRowCount: number;
  acceptedRowCount: number;
  rejectedRowCount: number;
  reviewRowCount: number;
  plannedRecordCount: number;
  importedRecordCount: number;
  sourceInventoryTotal: number | null;
  acceptedInventoryTotal: number;
  importedInventoryTotal: number;
  exceptionCount: number;
};

export function reconcileMigration(input: ReconciliationInput) {
  const mismatches: string[] = [];
  if (input.sourceRowCount !== input.stagingRowCount) mismatches.push('SOURCE_STAGING_ROW_COUNT');
  if (
    input.acceptedRowCount + input.rejectedRowCount + input.reviewRowCount !==
    input.stagingRowCount
  ) {
    mismatches.push('STAGING_DISPOSITION_COUNT');
  }
  if (input.plannedRecordCount !== input.importedRecordCount)
    mismatches.push('PLANNED_IMPORTED_COUNT');
  if (
    input.sourceInventoryTotal !== null &&
    input.sourceInventoryTotal !== input.acceptedInventoryTotal
  ) {
    mismatches.push('SOURCE_ACCEPTED_INVENTORY');
  }
  if (input.acceptedInventoryTotal !== input.importedInventoryTotal)
    mismatches.push('ACCEPTED_IMPORTED_INVENTORY');
  return { matched: mismatches.length === 0, mismatches, ...input };
}
