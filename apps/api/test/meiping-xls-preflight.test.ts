import * as XLSX from '@stackline/xlsx';
import { describe, expect, it } from 'vitest';
import { buildMeipingPreflight } from '../src/migration/meiping-preflight.js';
import { exceptionCsv, parseMeipingWorkbook, sourceChecksum } from '../src/migration/meiping-xls.js';

function workbookBuffer(rows: unknown[][], bookType: 'xls' | 'xlsx' = 'xls') {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '商品资料');
  const output = XLSX.write(workbook, { type: 'buffer', bookType }) as unknown;
  if (typeof output === 'string') return Buffer.from(output);
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('Unexpected workbook output');
}

const headers = ['商品编号', '自有编号', '商品名称', '作者', '出版社', '价格', '条码', '类别'];
const meipingHeaders = [
  '商品编号',
  '商品名称',
  '类别',
  '商品条码',
  '单位',
  '作者',
  '出版商',
  '状态',
  '特价商品',
  '定价',
  '销售折扣',
  '批发折扣',
  '采购折扣',
  '备注',
];

describe('Meiping workbook parser and dry-run preflight', () => {
  it('reads legacy XLS and XLSX while preserving source row and external identifiers', () => {
    const buffer = workbookBuffer([
      headers,
      ['M-001', 'OWN-001', '测试绘本', '作者', '出版社', '39.8', '690000000001', '图书'],
    ]);
    const parsed = parseMeipingWorkbook(buffer);
    expect(parsed.missingMappedFields).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      sourceRowNumber: 2,
      bookCode: 'M-001',
      internalCode: 'OWN-001',
      barcode: '690000000001',
      isbn: null,
      sourceCategoryType: 'BOOK',
      canonical: { title: '测试绘本', price: '39.8', inventory: 1 },
    });
    expect(
      parseMeipingWorkbook(
        workbookBuffer(
          [
            headers,
            ['M-001', 'OWN-001', '测试绘本', '作者', '出版社', '39.8', '690000000001', '图书'],
          ],
          'xlsx',
        ),
      ).rows,
    ).toHaveLength(1);
  });

  it('decodes Chinese legacy XLS headers and maps the Meiping columns without treating barcodes as ISBN', () => {
    const parsed = parseMeipingWorkbook(
      workbookBuffer([
        meipingHeaders,
        [
          '150001',
          '测试绘本',
          '少儿',
          '690000000001',
          '本',
          '测试作者',
          '测试出版商',
          '正常',
          '否',
          38,
          1,
          1,
          1,
          '',
        ],
      ]),
    );
    expect(parsed.headers).toEqual(meipingHeaders);
    expect(parsed.missingMappedFields).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      sourceRowNumber: 2,
      bookCode: '150001',
      barcode: '690000000001',
      isbn: null,
      sourceCategory: '少儿',
      sourceCategoryType: 'BOOK',
      canonical: { title: '测试绘本', publisher: '测试出版商', price: 38, inventory: 1 },
    });
  });

  it('excludes a formula summary row while preserving the product source row number', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      meipingHeaders,
      ['150001', '测试绘本', '文学', '690000000001', '本', '', '', '正常', '否', 38, 1, 1, 1, ''],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    sheet.J2 = { t: 'n', v: 38, f: '10+28' };
    sheet.A3 = { t: 'n', v: 1, f: 'COUNTA(A2:A2)' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '商品资料');
    const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as unknown;
    if (typeof output === 'string') throw new Error('Unexpected string workbook output');
    if (!(output instanceof Uint8Array)) throw new Error('Unexpected workbook output');
    const buffer = Buffer.from(output);
    const parsed = parseMeipingWorkbook(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.sourceRowNumber).toBe(2);
    expect(parsed.rows[0]!.hasFormula).toBe(true);
    const report = buildMeipingPreflight(parsed.rows, {
      storeId: 'store-east-test',
      storeCode: 'TEST-EAST',
    });
    expect(report.rows[0]!.issues.map((item) => item.code)).toContain('FORMULA_ROW_REVIEW');
  });

  it('keeps missing fields as row-level exceptions instead of dropping records', () => {
    const parsed = parseMeipingWorkbook(
      workbookBuffer([
        ['商品编号', '商品名称', '条码', '类别'],
        ['M-002', '', '690000000002', '其他商品'],
      ]),
    );
    expect(parsed.missingMappedFields).toContain('MISSING_COLUMN_PRICE');
    const report = buildMeipingPreflight(
      parsed.rows,
      { storeId: 'store-east-test', storeCode: 'TEST-EAST' },
      {
        missingMappedFields: parsed.missingMappedFields,
      },
    );
    expect(report.totalRows).toBe(1);
    expect(report.exceptionRows).toBe(1);
    expect(report.rows[0]!.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['TITLE_REQUIRED', 'MISSING_COLUMN_PRICE', 'NON_BOOK_CATEGORY']),
    );
  });

  it('flags duplicate and conflicting barcodes without merging rows', () => {
    const parsed = parseMeipingWorkbook(
      workbookBuffer([
        headers,
        ['M-003', 'OWN-003', '相同商品', '作者', '出版社', '20', '690000000003', '图书'],
        ['M-004', 'OWN-004', '相同商品', '作者', '出版社', '20', '690000000003', '图书'],
        ['M-005', 'OWN-005', '不同商品', '作者', '出版社', '21', '690000000003', '图书'],
      ]),
    );
    const report = buildMeipingPreflight(parsed.rows, {
      storeId: 'store-east-test',
      storeCode: 'TEST-EAST',
    });
    expect(report.totalRows).toBe(3);
    expect(report.rows.map((row) => row.sourceRowNumber)).toEqual([2, 3, 4]);
    expect(report.rows[0]!.issues.map((item) => item.code)).toContain('DUPLICATE_BARCODE');
    expect(report.rows[2]!.issues.map((item) => item.code)).toContain('BARCODE_CONFLICT');
    expect(report.exceptionReportCsv).toContain('BARCODE_CONFLICT');
  });

  it('neutralizes formula-like CSV cells without altering source values in JSON reports', () => {
    const untrustedTitle = '=HYPERLINK("https://example.invalid","unsafe")';
    const untrustedBarcode = '\t@SUM(1,2)';
    const rows = [
      { sourceRowNumber: 2, category: 'BOOK' as const, title: untrustedTitle, barcode: untrustedBarcode, reasonCodes: ['REVIEW'] },
      { sourceRowNumber: 3, category: 'BOOK' as const, title: ' \r\n+1+2', barcode: '-1+2', reasonCodes: ['REVIEW'] },
      { sourceRowNumber: 4, category: 'BOOK' as const, title: '\u200b-1+2', barcode: '@SUM(A1:A2)', reasonCodes: ['REVIEW'] },
      { sourceRowNumber: 5, category: 'BOOK' as const, title: '正常中文书名', barcode: '690000000001', reasonCodes: ['REVIEW'] },
    ];
    const csv = exceptionCsv(rows);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"",""unsafe"")"`);
    expect(csv).toContain(`"'\t@SUM(1,2)"`);
    expect(csv).toContain(`"' \r\n+1+2"`);
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'\u200b-1+2");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain('正常中文书名,690000000001');
    expect(rows[0]!.title).toBe(untrustedTitle);
    expect(rows[0]!.barcode).toBe(untrustedBarcode);

    const parsed = parseMeipingWorkbook(
      workbookBuffer([
        headers,
        ['M-CSV', 'OWN-CSV', untrustedTitle, '作者', '出版社', 0, untrustedBarcode, '图书'],
      ]),
    );
    const report = buildMeipingPreflight(parsed.rows, {
      storeId: 'store-east-test',
      storeCode: 'TEST-EAST',
    });
    expect(report.rows[0]!.rawColumns['商品名称']).toBe(untrustedTitle);
    expect(report.rows[0]!.sourceIdentifiers.barcode).toBe(untrustedBarcode);
    expect(report.exceptionReportCsv).toContain("'=HYPERLINK");
  });

  it('keeps assumed stock explicit and isolates the selected store', () => {
    const parsed = parseMeipingWorkbook(
      workbookBuffer([
        headers,
        ['M-006', 'OWN-006', '待盘点绘本', '作者', '出版社', '0', '690000000006', '图书'],
      ]),
    );
    const east = buildMeipingPreflight(parsed.rows, {
      storeId: 'store-east-test',
      storeCode: 'TEST-EAST',
    });
    const south = buildMeipingPreflight(parsed.rows, {
      storeId: 'store-south-test',
      storeCode: 'TEST-SOUTH',
    });
    expect(east.sourceStoreId).not.toBe(south.sourceStoreId);
    expect(east.rows[0]!.inventoryBasis).toBe('ASSUMED_PENDING_STOCKTAKE');
    expect(east.inventoryApproval).toBe('PENDING_ADMIN_REVIEW');
    expect(east.plannedInventoryTotal).toBe(1);
    expect(east.rows[0]!.issues.map((item) => item.code)).toContain('ZERO_PRICE');
  });

  it('produces stable checksums for duplicate-file detection without writing a database', () => {
    const first = workbookBuffer([
      headers,
      ['M-007', 'OWN-007', 'Checksum', '作者', '出版社', '10', '690000000007', '图书'],
    ]);
    const second = Buffer.from(first);
    expect(sourceChecksum(first)).toBe(sourceChecksum(second));
    expect(sourceChecksum(first)).toHaveLength(64);
  });
});
