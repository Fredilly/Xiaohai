import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import { StoreNetworkError } from '../src/stores/store-service.js';
import type { StoreNetworkService } from '../src/stores/store-service.js';
import type { FoodBatchPreviewService } from '../src/inventory/food-batch-preview-service.js';
import { registerFoodBatchPreviewRoutes } from '../src/inventory/food-batch-preview-routes.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const foreignStore = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';
const request = {
  businessDate: '2026-11-07',
  batches: [
    {
      id: batchId,
      storeId,
      skuId,
      lotCode: 'LOT-001',
      manufacturedOn: '2026-10-01',
      expiresOn: '2026-12-01',
      onHand: 2,
      reserved: 0,
      blocked: 0,
      state: 'AVAILABLE',
    },
  ],
};
const fakeResponse = {
  mode: 'READ_ONLY_PROPOSAL',
  checkoutEnabled: false,
  storeId,
  skuId,
  businessDate: '2026-11-07',
  result: {
    status: 'READY',
    sellable: 2,
    expiredOnHand: 0,
    blockedOnHand: 0,
    batches: [{ id: batchId, expiresOn: '2026-12-01', disposition: 'AVAILABLE', sellable: 2 }],
  },
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(
  permissions: string[] = ['stores.read', 'inventory.read'],
  canReadStore = true,
  isGlobal = false,
) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const preview = vi.fn().mockResolvedValue(fakeResponse);
  const getStaffStore = vi.fn((id: string) =>
    id === storeId && canReadStore
      ? Promise.resolve({ id })
      : Promise.reject(new StoreNetworkError('SCOPE_MISMATCH')),
  );
  registerFoodBatchPreviewRoutes(app, {
    staffAuthorization: {
      authenticate: (authorization: string | undefined) =>
        authorization === 'Bearer test-session'
          ? Promise.resolve({ staffAccountId: actorId, permissions })
          : Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401)),
      requirePermission: (_actor: unknown, permission: string) => {
        if (!permissions.includes(permission)) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
      },
      requireDataScope: (_actor: unknown, scope: string) => {
        if (scope !== 'GLOBAL' || !isGlobal) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
      },
    } as unknown as StaffAuthorizationService,
    stores: { getStaffStore } as unknown as StoreNetworkService,
    food: { preview } as unknown as FoodBatchPreviewService,
  });
  return { app, getStaffStore, preview };
}

const storePath = `/api/v1/staff/stores/${storeId}/inventory/food-batches/${skuId}/preview`;
const foreignPath = `/api/v1/staff/stores/${foreignStore}/inventory/food-batches/${skuId}/preview`;
const hqPath = `/api/v1/staff/inventory/stores/${storeId}/food-batches/${skuId}/preview`;

describe('read-only Store and HQ food inventory proposal routes (#208)', () => {
  it('requires a real authenticated session and both Store read permissions', async () => {
    const { app, preview } = setup();
    const anonymous = await app.inject({ method: 'POST', url: storePath, payload: request });
    expect(anonymous.statusCode).toBe(401);
    expect(preview).not.toHaveBeenCalled();

    const lacking = setup(['stores.read']);
    const unauthorized = await lacking.app.inject({
      method: 'POST',
      url: storePath,
      headers: { authorization: 'Bearer test-session' },
      payload: request,
    });
    expect(unauthorized.statusCode).toBe(403);
    expect(lacking.preview).not.toHaveBeenCalled();
  });

  it('blocks a foreign Store even if the identity holds both read permissions', async () => {
    const { app, preview } = setup();
    const denied = await app.inject({
      method: 'POST',
      url: foreignPath,
      headers: { authorization: 'Bearer test-session' },
      payload: request,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'STAFF_FORBIDDEN' } });
    expect(preview).not.toHaveBeenCalled();
  });

  it('rejects invalid dates, cross-store-shaped IDs and excessive data before DB access', async () => {
    const { app, preview } = setup();
    const headers = { authorization: 'Bearer test-session' };
    for (const payload of [
      { ...request, businessDate: '2026-02-30' },
      { ...request, batches: [{ ...request.batches[0], expiresOn: null }] },
      { ...request, batches: [{ ...request.batches[0], onHand: -1 }] },
      { ...request, batches: Array.from({ length: 501 }, () => request.batches[0]) },
      { ...request, unexpected: true },
    ]) {
      const response = await app.inject({ method: 'POST', url: storePath, headers, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(preview).not.toHaveBeenCalled();
  });

  it('passes authorized scope and an explicitly non-authoritative simulation', async () => {
    const { app, preview } = setup();
    const response = await app.inject({
      method: 'POST',
      url: storePath,
      headers: { authorization: 'Bearer test-session' },
      payload: request,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: 'READ_ONLY_PROPOSAL',
      checkoutEnabled: false,
      result: { sellable: 2 },
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith(storeId, skuId, request);
  });

  it('requires HQ GLOBAL data scope as well as inventory.read', async () => {
    const headers = { authorization: 'Bearer test-session' };
    const forbidden = setup(['inventory.read']);
    const denied = await forbidden.app.inject({
      method: 'POST',
      url: hqPath,
      headers,
      payload: request,
    });
    expect(denied.statusCode).toBe(403);
    expect(forbidden.preview).not.toHaveBeenCalled();

    const hq = setup(['inventory.read'], true, true);
    const allowed = await hq.app.inject({ method: 'POST', url: hqPath, headers, payload: request });
    expect(allowed.statusCode).toBe(200);
    expect(hq.preview).toHaveBeenCalledExactlyOnceWith(storeId, skuId, request);
    expect(hq.getStaffStore).not.toHaveBeenCalled();
  });
});
