import { describe, expect, it } from 'vitest';
import { parseYuanToMinor } from './catalog-manager';

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
