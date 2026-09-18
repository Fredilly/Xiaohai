import { describe, expect, it } from 'vitest';
import {
  deliveryZoneInputSchema,
  fulfilledOrderRequestSchema,
  pickupVerifyRequestSchema,
} from './fulfillment';

describe('M16 fulfillment contracts', () => {
  it('requires an address for delivery but not pickup', () => {
    expect(
      fulfilledOrderRequestSchema.safeParse({
        method: 'PICKUP',
        storeId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: 'request-0001',
      }).success,
    ).toBe(true);
    expect(
      fulfilledOrderRequestSchema.safeParse({
        method: 'DELIVERY',
        storeId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: 'request-0002',
      }).success,
    ).toBe(false);
  });

  it('rejects server-controlled fulfillment fields and malformed pickup codes', () => {
    expect(
      fulfilledOrderRequestSchema.safeParse({
        method: 'PICKUP',
        storeId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: 'request-0003',
        deliveryFeeMinor: 1,
      }).success,
    ).toBe(false);
    expect(
      pickupVerifyRequestSchema.safeParse({
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        pickupCode: '12345',
      }).success,
    ).toBe(false);
  });

  it('keeps delivery fees and providers configurable', () => {
    const zone = deliveryZoneInputSchema.parse({
      storeId: '11111111-1111-4111-8111-111111111111',
      name: '同城',
      region: '四川省',
      city: '成都市',
      district: null,
      feeMinor: 600,
      active: true,
    });
    expect(zone.providerKey).toBe('MANUAL');
    expect(zone.feeMinor).toBe(600);
  });
});
