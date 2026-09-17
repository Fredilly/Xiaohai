import { describe, expect, it } from 'vitest';
import { publicInventoryQuerySchema } from './inventory.js';

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
