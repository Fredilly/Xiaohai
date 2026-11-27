import { describe, expect, it } from 'vitest';
import {
  CatalogManager,
  applyCatalogDraftDefaults,
  bookLookupPolicy,
  isPreviewableProductImage,
  parseYuanToMinor,
} from './catalog-manager';

describe('HQ catalog session scope', () => {
  it('remounts product and store editors when the login session changes', () => {
    const staffAccountId = '11111111-1111-4111-8111-111111111111';
    expect(CatalogManager({ token: 'staff-session-a', staffAccountId }).key).toBe(
      `${staffAccountId}:staff-session-a`,
    );
    expect(CatalogManager({ token: 'staff-session-b', staffAccountId }).key).toBe(
      `${staffAccountId}:staff-session-b`,
    );
  });
});

describe('HQ new-book price input', () => {
  it.each([
    ['12.00', 1200],
    ['15.00', 1500],
    ['39.80', 3980],
    ['0.01', 1],
    ['0.00', 0],
  ])('converts %s yuan to %s minor units exactly', (input, expected) => {
    expect(parseYuanToMinor(input)).toBe(expected);
  });

  it.each(['', '1.234', '-1.00', '01.00', 'NaN', 'Infinity', '21474836.48'])(
    'rejects %s',
    (input) => {
      expect(parseYuanToMinor(input)).toBeNull();
    },
  );
});

// Regression: editing an existing book must not call ISBN lookup on blur,
// replace unsaved form fields, or be rejected as a duplicate new book.
describe('HQ new-book lookup isolation', () => {
  it('allows a lookup but blocks duplicate creation for a new book', () => {
    expect(bookLookupPolicy(false, true)).toEqual({
      canLookUp: true,
      blockDuplicateCreate: true,
    });
    expect(bookLookupPolicy(false, false)).toEqual({
      canLookUp: true,
      blockDuplicateCreate: false,
    });
  });

  it('never looks up or blocks saving when editing an existing book', () => {
    expect(bookLookupPolicy(true, true)).toEqual({
      canLookUp: false,
      blockDuplicateCreate: false,
    });
    expect(bookLookupPolicy(true, false)).toEqual({
      canLookUp: false,
      blockDuplicateCreate: false,
    });
  });
});

describe('HQ product creation is safe by default (#208)', () => {
  const input = {
    name: '食品',
    status: 'ACTIVE' as const,
    book: null,
    sku: {
      code: 'TEST',
      name: '成品',
      priceMinor: 1000,
      status: 'ACTIVE' as const,
      availableForSale: true,
    },
  };
  it('never publishes or permits purchases on initial save', () => {
    expect(applyCatalogDraftDefaults(input, false)).toMatchObject({
      status: 'DRAFT',
      sku: { availableForSale: false },
    });
    expect(input.status).toBe('ACTIVE');
    expect(input.sku.availableForSale).toBe(true);
  });
  it('preserves explicit status changes while editing an existing product', () => {
    expect(applyCatalogDraftDefaults(input, true)).toEqual(input);
  });
});

describe('HQ photo preview rejects private and unsafe sources', () => {
  it('previews only stable public HTTPS URLs', () => {
    expect(isPreviewableProductImage('https://cdn.example.com/a.jpg')).toBe(true);
    for (const url of [
      'http://cdn.example.com/a.jpg',
      'https://cdn.example.com/a.jpg?signature=private',
      'https://127.0.0.1/a.jpg',
      'https://localhost/a.jpg',
      'https://cdn.example.invalid/a.jpg',
      'javascript:alert(1)',
    ]) {
      expect(isPreviewableProductImage(url), url).toBe(false);
    }
  });
});
