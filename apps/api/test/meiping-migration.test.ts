import { describe, expect, it } from 'vitest';
import {
  dryRunCanonicalMigration,
  normalizeCanonicalRecord,
  normalizeText,
  parseInventory,
  parsePriceMinor,
  reconcileMigration,
} from '../src/migration/meiping.js';

// TEST FIXTURE / CANONICAL SAMPLE — NOT A REAL MEIPING EXPORT.
const valid = {
  bookCode: ' B-001 ',
  internalCode: ' OWN-001 ',
  title: '  小海童话  ',
  author: ' 作者 A ',
  publisher: ' 出版社 A ',
  price: '￥39.80',
  inventory: '12',
};

describe('M3 canonical Meiping migration boundary', () => {
  it('normalizes strings deterministically without treating book code as ISBN', () => {
    expect(normalizeText('  Ａ  B  ')).toBe('A B');
    expect(normalizeCanonicalRecord(valid)).toEqual({
      bookCode: 'B-001',
      internalCode: 'OWN-001',
      title: '小海童话',
      author: '作者 A',
      publisher: '出版社 A',
      priceMinor: 3980,
      inventory: 12,
    });
  });

  it('parses money without floating point and rejects malformed amounts', () => {
    expect(parsePriceMinor('0.01')).toBe(1);
    expect(parsePriceMinor('12.3')).toBe(1230);
    expect(parsePriceMinor('12.345')).toBeNull();
    expect(parsePriceMinor('-1')).toBeNull();
    expect(parsePriceMinor('abc')).toBeNull();
  });

  it('keeps price minor units within the PostgreSQL integer staging range', () => {
    expect(parsePriceMinor('21474836.47')).toBe(2147483647);
    expect(parsePriceMinor('21474836.48')).toBeNull();
  });

  it('parses integer inventory and preserves negative values for explicit validation', () => {
    expect(parseInventory('10')).toBe(10);
    expect(parseInventory('-2')).toBe(-2);
    expect(parseInventory('1.5')).toBeNull();
  });

  it('keeps inventory within the PostgreSQL integer staging range', () => {
    expect(parseInventory('-2147483648')).toBe(-2147483648);
    expect(parseInventory('2147483647')).toBe(2147483647);
    expect(parseInventory('-2147483649')).toBeNull();
    expect(parseInventory('2147483648')).toBeNull();
  });

  it('reports missing, malformed, and negative data instead of silently discarding it', () => {
    const report = dryRunCanonicalMigration([
      { ...valid, title: ' ', price: 'oops', inventory: '-1' },
    ]);
    expect(report.errorRows).toBe(1);
    expect(report.importableRows).toBe(0);
    expect(report.rows[0]!.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TITLE_REQUIRED', 'PRICE_INVALID', 'INVENTORY_NEGATIVE']),
    );
  });

  it('detects exact duplicates and identifier conflicts without overwriting either row', () => {
    const report = dryRunCanonicalMigration([
      valid,
      { ...valid },
      { ...valid, title: '另一本书' },
      { ...valid, bookCode: 'B-002', title: '第三本书' },
    ]);
    expect(report.rows[1]!.disposition).toBe('DUPLICATE');
    expect(report.rows[2]!.issues.map((issue) => issue.code)).toContain('BOOK_CODE_CONFLICT');
    expect(report.rows[3]!.issues.map((issue) => issue.code)).toContain('INTERNAL_CODE_CONFLICT');
    expect(report.duplicateOrConflictRows).toBe(3);
  });

  it('rejects an invalid duplicate instead of letting duplicate classification hide errors', () => {
    const invalid = { ...valid, title: '', inventory: '-1' };
    const report = dryRunCanonicalMigration([invalid, { ...invalid }]);

    expect(report.rows[0]!.disposition).toBe('REJECTED');
    expect(report.rows[1]!.disposition).toBe('REJECTED');
    expect(report.rows[1]!.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TITLE_REQUIRED', 'INVENTORY_NEGATIVE', 'DUPLICATE_ROW']),
    );
  });

  it('routes uncertain bibliographic data to review', () => {
    const report = dryRunCanonicalMigration([{ ...valid, author: '', publisher: '' }]);
    expect(report.rows[0]!.disposition).toBe('REVIEW');
    expect(report.reviewRows).toBe(1);
  });

  it('is deterministic and is a pure dry run with no business-data writer', () => {
    const fixture = [valid, { ...valid, bookCode: 'B-002', internalCode: 'OWN-002' }];
    expect(dryRunCanonicalMigration(fixture)).toEqual(dryRunCanonicalMigration(fixture));
    expect(fixture[0]).toEqual(valid);
  });

  it('makes reconciliation mismatches visible', () => {
    const result = reconcileMigration({
      sourceRowCount: 2,
      stagingRowCount: 1,
      acceptedRowCount: 1,
      rejectedRowCount: 0,
      reviewRowCount: 0,
      plannedRecordCount: 1,
      importedRecordCount: 0,
      sourceInventoryTotal: 12,
      acceptedInventoryTotal: 10,
      importedInventoryTotal: 0,
      exceptionCount: 1,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        'SOURCE_STAGING_ROW_COUNT',
        'PLANNED_IMPORTED_COUNT',
        'SOURCE_ACCEPTED_INVENTORY',
        'ACCEPTED_IMPORTED_INVENTORY',
      ]),
    );
  });
});
