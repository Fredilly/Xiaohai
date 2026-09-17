import { describe, expect, it } from 'vitest';
import {
  createStoreRequestSchema,
  publicStoreQuerySchema,
  updateStoreRequestSchema,
} from './stores.js';

const storeInput = {
  code: 'CD-NANMEN',
  regionId: '11111111-1111-4111-8111-111111111111',
  name: '胖竹书店南门店',
  countryCode: 'cn',
  countryName: '中国',
  city: '成都',
  timezone: 'Asia/Shanghai',
  addressLine: '测试地址',
  latitude: 30.65,
  longitude: 104.06,
  services: ['阅读', '自习'],
};

describe('M12 store network contracts', () => {
  it('normalizes country code and rejects coordinates outside valid ranges', () => {
    expect(createStoreRequestSchema.parse(storeInput).countryCode).toBe('CN');
    expect(createStoreRequestSchema.safeParse({ ...storeInput, latitude: 91 }).success).toBe(false);
    expect(createStoreRequestSchema.safeParse({ ...storeInput, longitude: -181 }).success).toBe(
      false,
    );
  });

  it('requires latitude and longitude together for nearby queries', () => {
    expect(publicStoreQuerySchema.safeParse({ latitude: '30.6' }).success).toBe(false);
    expect(
      publicStoreQuerySchema.safeParse({ latitude: '30.6', longitude: '104.0', radiusKm: '10' })
        .success,
    ).toBe(true);
    expect(publicStoreQuerySchema.safeParse({ radiusKm: '10' }).success).toBe(false);
    expect(
      publicStoreQuerySchema.safeParse({ latitude: '30.6', longitude: '104.0', radiusKm: '201' })
        .success,
    ).toBe(false);
  });

  it('keeps M13 inventory fields outside the M12 store write contract', () => {
    expect(createStoreRequestSchema.safeParse({ ...storeInput, inventory: 100 }).success).toBe(
      false,
    );
    expect(updateStoreRequestSchema.safeParse({ inventory: 100 }).success).toBe(false);
  });

  it('does not allow store hierarchy reparenting through ordinary store updates', () => {
    expect(
      updateStoreRequestSchema.safeParse({
        regionId: '22222222-2222-4222-8222-222222222222',
      }).success,
    ).toBe(false);
    expect(updateStoreRequestSchema.safeParse({ name: '新门店名称' }).success).toBe(true);
  });
});
