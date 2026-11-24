import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { registerFoodStockRoutes } from '../src/inventory/food-stock-routes.js';
import { FoodStockError } from '../src/inventory/food-stock-operations-service.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import type { FoodStockOperationsService } from '../src/inventory/food-stock-operations-service.js';
import type { FoodBatchMovementService } from '../src/inventory/food-batch-movement-service.js';
const input = {
  storeId: randomUUID(),
  skuId: randomUUID(),
  kind: 'PACKAGED_FOOD',
  expectedInventoryVersion: 0,
  lotCode: 'TEST',
  manufacturedOn: null,
  expiresOn: '2099-12-31',
  quantity: 1,
  idempotencyKey: randomUUID(),
  reason: 'Synthetic',
  sourceRef: 'synthetic:test',
};
function fixture(enabled?: boolean) {
  const app = Fastify();
  const receive = vi.fn().mockResolvedValue({ replayed: false });
  const read = vi.fn().mockResolvedValue({ checkoutEnabled: false });
  const permission = vi.fn();
  registerFoodStockRoutes(app, {
    writesEnabled: enabled,
    staffAuthorization: {
      authenticate: vi.fn().mockResolvedValue({ staffAccountId: randomUUID() }),
      requirePermission: permission,
    } as unknown as StaffAuthorizationService,
    food: { receive, read } as unknown as FoodStockOperationsService,
    movement: { apply: vi.fn() } as unknown as FoodBatchMovementService,
  });
  return { app, receive, read, permission };
}
describe('food stock HTTP fail-closed boundary', () => {
  it.each([undefined, false])('default/off writes cannot reach service (%s)', async (enabled) => {
    const f = fixture(enabled);
    try {
      const r = await f.app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/food-stock/intake',
        payload: input,
      });
      expect(r.statusCode).toBe(503);
      expect(r.json<{ error: { code: string } }>().error.code).toBe('FOOD_STOCK_WRITES_DISABLED');
      expect(f.receive).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it('enabled writes still require both permissions', async () => {
    const f = fixture(true);
    try {
      const r = await f.app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/food-stock/intake',
        payload: input,
      });
      expect(r.statusCode).toBe(201);
      expect(f.permission.mock.calls.map((c) => c[1] as unknown)).toEqual([
        'inventory.read',
        'inventory.receive',
      ]);
      expect(f.receive).toHaveBeenCalledOnce();
    } finally {
      await f.app.close();
    }
  });
  it.each([
    new Error('postgresql://secret:password@private/db?signature=secret'),
    new FoodStockError('FORBIDDEN'),
  ])('never serializes raw service errors', async (error) => {
    const f = fixture(true);
    try {
      f.receive.mockRejectedValue(error);
      const r = await f.app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/food-stock/intake',
        payload: input,
      });
      expect([403, 500]).toContain(r.statusCode);
      expect(r.body).not.toMatch(/postgresql|password|signature|private/);
    } finally {
      await f.app.close();
    }
  });
  it('rejects URL evidence and extra fields before calling service', async () => {
    const f = fixture(true);
    try {
      for (const payload of [
        { ...input, sourceRef: 'https://private/?sig=secret' },
        { ...input, unsafe: true },
      ]) {
        const r = await f.app.inject({
          method: 'POST',
          url: '/api/v1/staff/inventory/food-stock/intake',
          payload,
        });
        expect(r.statusCode).toBe(400);
        expect(r.body).not.toContain('secret');
      }
      expect(f.receive).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
});
