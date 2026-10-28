import { describe, expect, it } from 'vitest';
import { bookLookupPolicy, parseYuanToMinor } from './catalog-manager';

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
