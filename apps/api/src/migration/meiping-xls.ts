import { createHash } from 'node:crypto';
import * as XLSX from '@stackline/xlsx';
import * as codepageModule from '@stackline/xlsx/dist/cpexcel.full.mjs';
import type { CanonicalMigrationInput } from './meiping.js';

// The Meiping export is a legacy BIFF workbook whose byte strings use CP936.
// The hardened SheetJS-compatible package keeps code-page tables optional, so
// register the bundled tables explicitly before reading any legacy workbook.
const codepage = codepageModule as unknown as {
  cptable: Record<string, unknown>;
  utils: { decode: (codepage: number, data: Uint8Array) => string };
};
XLSX.set_cptable({ ...codepage.cptable, utils: codepage.utils });

export type MeipingSourceCategory = 'BOOK' | 'NON_BOOK' | 'UNKNOWN';

export type MeipingParsedRow = {
  sourceRowNumber: number;
  rawColumns: Record<string, unknown>;
  sourceCategory: string | null;
  sourceCategoryType: MeipingSourceCategory;
  hasFormula: boolean;
  bookCode: string | null;
  internalCode: string | null;
  barcode: string | null;
  isbn: string | null;
  canonical: CanonicalMigrationInput;
};

export type MeipingWorkbook = {
  sheetName: string;
  headers: string[];
  missingMappedFields: string[];
  rows: MeipingParsedRow[];
};

export function sourceChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const aliases = {
  bookCode: ['图书编码', '商品编码', '商品编号', '货号', '图书编号', '编码'],
  internalCode: ['自有编号', '内部编号', '自编号', '本店编号', '自有编码'],
  title: ['图书名字', '图书名称', '商品名称', '商品名字', '书名', '名称'],
  author: ['作者', '作者名称'],
  publisher: ['出版社', '出版商'],
  price: ['价格', '售价', '零售价', '定价', '销售价'],
  barcode: ['条码', '商品条码', '条形码', 'barcode', 'ean'],
  isbn: ['isbn', 'ISBN', '国际标准书号'],
  category: ['类别', '商品类别', '分类', '商品分类', '类型'],
} as const;

function cleanHeader(value: unknown): string {
  return (text(value) ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : null;
  if (raw === null) return null;
  const normalized = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

function findHeader(headers: string[], candidates: readonly string[]): string | undefined {
  const normalized = new Map(headers.map((header) => [cleanHeader(header), header]));
  for (const candidate of candidates) {
    const found = normalized.get(cleanHeader(candidate));
    if (found) return found;
  }
  return undefined;
}

function categoryType(value: string | null): MeipingSourceCategory {
  if (!value) return 'UNKNOWN';
  const normalized = value.normalize('NFKC').trim();
  const bookCategories = new Set([
    '图书',
    '绘本',
    '童书',
    '读物',
    '少儿',
    '文学',
    '教育',
    '工具书',
  ]);
  return bookCategories.has(normalized) ? 'BOOK' : 'NON_BOOK';
}

function firstNonEmptyRow(rows: unknown[][]): number {
  const index = rows.findIndex((row) => row.some((value) => text(value) !== null));
  if (index < 0) throw new Error('WORKBOOK_EMPTY');
  return index;
}

function columnIndex(column: string): number {
  return [...column].reduce((index, character) => index * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

export function parseMeipingWorkbook(buffer: Buffer): MeipingWorkbook {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellFormula: true,
    raw: true,
    // Meiping's legacy BIFF export uses the GBK-compatible Windows-936 code page.
    codepage: 936,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('WORKBOOK_NO_SHEET');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('WORKBOOK_NO_SHEET');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const headerIndex = firstNonEmptyRow(matrix);
  const headerValues = matrix[headerIndex] ?? [];
  const lastHeaderIndex = headerValues.reduce<number>(
    (last, value, index) => (text(value) === null ? last : index),
    -1,
  );
  const headers = headerValues
    .slice(0, lastHeaderIndex + 1)
    .map((value, index) => text(value) ?? `未命名列${index + 1}`);
  const keys = Object.fromEntries(
    Object.entries(aliases).map(([key, candidates]) => [key, findHeader(headers, candidates)]),
  ) as Record<keyof typeof aliases, string | undefined>;
  const missingMappedFields = ['title', 'price']
    .filter((key) => !keys[key as keyof typeof keys])
    .map((key) => `MISSING_COLUMN_${key.toUpperCase()}`);
  const formulasByRow = new Map<number, string[]>();
  const formulaColumnsByRow = new Map<number, Set<number>>();
  const sheetEntries = Object.entries(sheet) as Array<[string, { f?: unknown }]>;
  for (const [address, cell] of sheetEntries) {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (match) {
      const formula = cell.f;
      if (typeof formula === 'string') {
        const rowNumber = Number(match[2]);
        const formulas = formulasByRow.get(rowNumber) ?? [];
        formulas.push(formula);
        formulasByRow.set(rowNumber, formulas);
        const columns = formulaColumnsByRow.get(rowNumber) ?? new Set<number>();
        columns.add(columnIndex(match[1]!));
        formulaColumnsByRow.set(rowNumber, columns);
      }
    }
  }
  const lastNonEmptyRowNumber = matrix.reduce(
    (last, values, index) =>
      values.some((value) => text(value) !== null) ? headerIndex + index + 1 : last,
    headerIndex + 1,
  );

  const rows = matrix.slice(headerIndex + 1).flatMap((values, offset) => {
    const sourceRowNumber = headerIndex + offset + 2;
    const rawColumns = Object.fromEntries(
      headers.map((header, index) => [header, values?.[index] ?? null]),
    );
    if (Object.values(rawColumns).every((value) => text(value) === null)) return [];
    const valueOf = (key: keyof typeof keys) => {
      const header = keys[key];
      return header ? rawColumns[header] : null;
    };
    const formulas = formulasByRow.get(sourceRowNumber) ?? [];
    const formulaColumns = formulaColumnsByRow.get(sourceRowNumber) ?? new Set<number>();
    const hasFormula = formulas.length > 0;
    const hasProductIdentity = ['bookCode', 'internalCode', 'title', 'barcode', 'isbn', 'category']
      .map((key) => {
        const header = keys[key as keyof typeof keys];
        return header && !formulaColumns.has(headers.indexOf(header))
          ? valueOf(key as keyof typeof keys)
          : null;
      })
      .some((value) => text(value) !== null);
    const isAggregateFormula = formulas.every((formula) =>
      /^(?:=)?\s*(?:COUNTA|COUNT|SUM|SUBTOTAL|AVERAGE|MIN|MAX)\s*\(/i.test(formula),
    );
    const isSummaryFooter =
      hasFormula &&
      sourceRowNumber === lastNonEmptyRowNumber &&
      !hasProductIdentity &&
      isAggregateFormula;
    if (isSummaryFooter) return [];
    const sourceCategory = text(valueOf('category'));
    const bookCode = text(valueOf('bookCode'));
    const internalCode = text(valueOf('internalCode'));
    const barcode = text(valueOf('barcode'));
    const isbn = text(valueOf('isbn'));
    return [
      {
        sourceRowNumber,
        rawColumns,
        sourceCategory,
        sourceCategoryType: categoryType(sourceCategory),
        hasFormula,
        bookCode,
        internalCode,
        barcode,
        isbn,
        canonical: {
          bookCode: bookCode ?? undefined,
          internalCode: internalCode ?? undefined,
          title: valueOf('title') ?? undefined,
          author: valueOf('author') ?? undefined,
          publisher: valueOf('publisher') ?? undefined,
          price: valueOf('price') ?? undefined,
          // The source workbook has no reliable stock field. The value is a plan, not source truth.
          inventory: 1,
        },
      } satisfies MeipingParsedRow,
    ];
  });

  return { sheetName, headers, missingMappedFields, rows };
}

export function exceptionCsv(
  rows: Array<{
    sourceRowNumber: number;
    title: string | null;
    barcode: string | null;
    category: MeipingSourceCategory;
    disposition: string;
    metadataWarningCodes: string[];
    blockingIssueCodes: string[];
    saleBlockedCodes: string[];
  }>,
): string {
  const escape = (value: string | number | null) => {
    const textValue = value === null ? '' : String(value);
    return /[",\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
  };
  return (
    [
      'source_row_number,category,disposition,title,barcode,metadata_warning_codes,blocking_issue_codes,sale_blocked_codes,issue_count',
      ...rows.map((row) =>
        [
          row.sourceRowNumber,
          row.category,
          row.disposition,
          row.title,
          row.barcode,
          row.metadataWarningCodes.join('|'),
          row.blockingIssueCodes.join('|'),
          row.saleBlockedCodes.join('|'),
          row.metadataWarningCodes.length +
            row.blockingIssueCodes.length +
            row.saleBlockedCodes.length,
        ]
          .map(escape)
          .join(','),
      ),
    ].join('\n') + '\n'
  );
}
