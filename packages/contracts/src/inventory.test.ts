import { describe, expect, it } from 'vitest';
import {
  createPurchaseOrderRequestSchema,
  createStockTransferRequestSchema,
  inventoryAdjustmentRequestSchema,
  inventoryMutationRequestSchema,
  publicInventoryQuerySchema,
} from './inventory.js';

describe('M13 inventory contracts', () => {
  it('accepts bounded search and paired nearby coordinates', () => {
    const parsed = publicInventoryQuerySchema.parse({
      q: '  小海  ',
      availability: 'SALE',
      latitude: '30.65',
      longitude: '104.06',
      radiusKm: '25',
      limit: '50',
    });

    expect(parsed.q).toBe('小海');
    expect(parsed.availability).toBe('SALE');
    expect(parsed.latitude).toBe(30.65);
    expect(parsed.longitude).toBe(104.06);
    expect(parsed.radiusKm).toBe(25);
    expect(parsed.limit).toBe(50);
  });

  it('rejects incomplete nearby coordinates and radius without coordinates', () => {
    expect(publicInventoryQuerySchema.safeParse({ latitude: 30.65 }).success).toBe(false);
    expect(publicInventoryQuerySchema.safeParse({ radiusKm: 20 }).success).toBe(false);
  });

  it('bounds inventory result limits', () => {
    expect(publicInventoryQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(publicInventoryQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(publicInventoryQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(publicInventoryQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects unknown availability modes and unknown query keys', () => {
    expect(publicInventoryQuerySchema.safeParse({ availability: 'PICKUP' }).success).toBe(false);
    expect(publicInventoryQuerySchema.safeParse({ unknown: 'value' }).success).toBe(false);
  });
});

describe('M14 inventory operation contracts', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';

  it('keeps mutation requests strict and requires optimistic concurrency plus idempotency', () => {
    const valid = {
      storeId: id,
      skuId: second,
      quantity: 1,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      reason: '门店销售出库',
    };
    expect(inventoryMutationRequestSchema.safeParse(valid).success).toBe(true);
    expect(inventoryMutationRequestSchema.safeParse({ ...valid, storeScopeId: id }).success).toBe(
      false,
    );
    expect(inventoryMutationRequestSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(
      inventoryAdjustmentRequestSchema.safeParse({
        ...valid,
        quantity: undefined,
        quantityDelta: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate SKU lines and same-store transfers', () => {
    expect(
      createPurchaseOrderRequestSchema.safeParse({
        supplierId: id,
        storeId: second,
        items: [
          { skuId: id, quantity: 1 },
          { skuId: id, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      createStockTransferRequestSchema.safeParse({
        sourceStoreId: id,
        destinationStoreId: id,
        items: [{ skuId: second, quantity: 1 }],
      }).success,
    ).toBe(false);
  });

  it('does not accept client-controlled state or balance fields', () => {
    expect(
      createPurchaseOrderRequestSchema.safeParse({
        supplierId: id,
        storeId: second,
        status: 'RECEIVED',
        items: [{ skuId: id, quantity: 1 }],
      }).success,
    ).toBe(false);
  });
});
