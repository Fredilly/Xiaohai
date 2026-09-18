import { describe, expect, it } from 'vitest';
import { createRentalRequestSchema, rentalActionRequestSchema } from '../src/rental.js';

const id = '11111111-1111-4111-8111-111111111111';
describe('rental contracts', () => {
  it('accepts a strict reservation request', () => {
    expect(
      createRentalRequestSchema.safeParse({
        storeId: id,
        items: [{ skuId: id, quantity: 1 }],
        idempotencyKey: id,
      }).success,
    ).toBe(true);
  });
  it('rejects duplicate SKUs and server-controlled fields', () => {
    expect(
      createRentalRequestSchema.safeParse({
        storeId: id,
        items: [
          { skuId: id, quantity: 1 },
          { skuId: id, quantity: 1 },
        ],
        idempotencyKey: id,
      }).success,
    ).toBe(false);
    expect(
      createRentalRequestSchema.safeParse({
        storeId: id,
        items: [{ skuId: id, quantity: 1 }],
        idempotencyKey: id,
        status: 'BORROWED',
        dueAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
  it('keeps actions idempotent and strict', () => {
    expect(rentalActionRequestSchema.safeParse({ idempotencyKey: id }).success).toBe(true);
    expect(rentalActionRequestSchema.safeParse({ idempotencyKey: id, storeId: id }).success).toBe(
      false,
    );
  });
});
