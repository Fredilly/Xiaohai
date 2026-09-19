import { describe, expect, it } from 'vitest';
import { hqOrderListQuerySchema, hqUserListQuerySchema } from './hq.js';

describe('M20 HQ read contracts', () => {
  it('keeps order filters strict and bounded', () => {
    expect(hqOrderListQuerySchema.parse({ status: 'PAID', limit: '20' })).toEqual({
      status: 'PAID',
      limit: 20,
    });
    expect(hqOrderListQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(hqOrderListQuerySchema.safeParse({ serverOnly: true }).success).toBe(false);
  });

  it('accepts only minimal user filters', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(hqUserListQuerySchema.parse({ id, limit: '10' })).toEqual({ id, limit: 10 });
    expect(hqUserListQuerySchema.safeParse({ openid: 'should-not-be-supported' }).success).toBe(
      false,
    );
  });
});
