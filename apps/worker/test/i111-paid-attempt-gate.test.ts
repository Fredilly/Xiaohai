import { describe, expect, it } from 'vitest';
import {
  I111_PAID_RUN,
  assertI111Slot,
  i111AllowedSlots,
} from '../src/i111-paid-attempt-gate.js';

const page1 = I111_PAID_RUN.page1Id;
const page2 = I111_PAID_RUN.page2Id;
const illustration = (pageId: string, revisionNumber: number) => ({
  id: crypto.randomUUID(),
  pageId,
  revisionNumber,
  provider: 'BAILIAN',
  model: 'qwen-image-3.0',
});

describe('#111 exactly three paid attempts, fixed page and revision order', () => {
  it('allows only page 1 original, page 2 original, then page 2 revision 2', () => {
    expect(i111AllowedSlots(I111_PAID_RUN)).toEqual([
      { pageId: page1, revisionNumber: 1 },
      { pageId: page2, revisionNumber: 1 },
      { pageId: page2, revisionNumber: 2 },
    ]);
    expect(assertI111Slot(I111_PAID_RUN, 0, illustration(page1, 1))).toBe(1);
    expect(assertI111Slot(I111_PAID_RUN, 1, illustration(page2, 1))).toBe(2);
    expect(assertI111Slot(I111_PAID_RUN, 2, illustration(page2, 2))).toBe(3);
  });

  it('rejects cover, wrong order, model, revision and fourth attempt', () => {
    for (const [attempts, row] of [
      [0, illustration(page2, 1)],
      [0, illustration(page1, 2)],
      [1, illustration(page1, 1)],
      [1, illustration(page2, 2)],
      [2, illustration(page2, 3)],
      [3, illustration(page2, 2)],
      [4, illustration(page2, 3)],
      [-1, illustration(page1, 1)],
      [Number.NaN, illustration(page1, 1)],
      [0, { ...illustration(page1, 1), provider: 'MOCK' }],
      [0, { ...illustration(page1, 1), model: 'qwen-image-3.0-pro' }],
    ] as const) {
      expect(() => assertI111Slot(I111_PAID_RUN, attempts, row)).toThrow(
        'I111_PAID_ATTEMPT_STOP',
      );
    }
  });
});
