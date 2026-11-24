import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import { StoreNetworkError } from '../src/stores/store-service.js';
import type { StoreNetworkService } from '../src/stores/store-service.js';
import type { CommerceService } from '../src/commerce/commerce-service.js';
import { registerStoreCatalogCreateRoutes } from '../src/commerce/store-catalog-create-routes.js';

const own = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const created = {
  id: '44444444-4444-4444-8444-444444444444',
  skuId: '55555555-5555-4555-8555-555555555555',
  bookId: null,
  editionId: null,
  productVersion: 0,
  bookVersion: null,
  editionVersion: null,
  skuVersion: 0,
  name: '门店真实商品草稿',
  description: null,
  coverUrl: null,
  status: 'DRAFT' as const,
  book: null,
  sku: {
    code: 'ST-001',
    name: '标准',
    priceMinor: 1500,
    status: 'ACTIVE' as const,
    availableForSale: false,
  },
};
const payload = {
  name: created.name,
  status: 'DRAFT',
  book: null,
  sku: { ...created.sku },
};
const headers = {
  authorization: 'Bearer scoped-test-session',
  'idempotency-key': 'store-create-test-001',
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(
  permissions: string[] = ['stores.read', 'catalog.edit'],
  authorizedStore: string = own,
) {
  const app = Fastify();
  apps.push(app);
  const createStoreDraftProduct = vi.fn(() => Promise.resolve(created));
  const getStaffStore = vi.fn((storeId: string) =>
    storeId === authorizedStore
      ? Promise.resolve({ id: storeId })
      : Promise.reject(new StoreNetworkError('SCOPE_MISMATCH')),
  );
  registerStoreCatalogCreateRoutes(app, {
    staffAuthorization: {
      authenticate: (token: string | undefined) =>
        token === headers.authorization
          ? Promise.resolve({ staffAccountId: actor, permissions })
          : Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401)),
      requirePermission: (_actor: unknown, key: string) => {
        if (!permissions.includes(key)) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
      },
    } as unknown as StaffAuthorizationService,
    stores: { getStaffStore } as unknown as StoreNetworkService,
    commerce: { createStoreDraftProduct } as unknown as CommerceService,
  });
  return { app, getStaffStore, createStoreDraftProduct };
}

describe('store-scoped catalog draft creation (#208)', () => {
  const url = `/api/v1/staff/stores/${own}/catalog/products`;
  it('rejects unauthenticated requests before touching product data', async () => {
    const { app, getStaffStore, createStoreDraftProduct } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': headers['idempotency-key'] },
      payload,
    });
    expect(response.statusCode).toBe(401);
    expect(getStaffStore).not.toHaveBeenCalled();
    expect(createStoreDraftProduct).not.toHaveBeenCalled();
  });

  it('requires catalog.edit and the authenticated store scope', async () => {
    for (const [perms, scope] of [
      [['stores.read'], own],
      [['catalog.edit'], own],
      [['stores.read', 'catalog.edit'], foreign],
    ] as const) {
      const { app, createStoreDraftProduct } = fixture([...perms], scope);
      const response = await app.inject({ method: 'POST', url, headers, payload });
      expect(response.statusCode).toBe(403);
      expect(createStoreDraftProduct).not.toHaveBeenCalled();
    }
  });

  it('rejects public ACTIVE or purchasable create input and missing retry key', async () => {
    const { app, createStoreDraftProduct } = fixture();
    for (const [body, h] of [
      [{ ...payload, status: 'ACTIVE' }, headers],
      [{ ...payload, sku: { ...payload.sku, availableForSale: true } }, headers],
      [payload, { authorization: headers.authorization }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, headers: h, payload: body });
      expect(response.statusCode).toBe(400);
    }
    expect(createStoreDraftProduct).not.toHaveBeenCalled();
  });

  it('returns a draft and passes the exact scoped store, actor and retry key', async () => {
    const { app, getStaffStore, createStoreDraftProduct } = fixture();
    const response = await app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: created.id,
      status: 'DRAFT',
      sku: { priceMinor: 1500, availableForSale: false },
    });
    expect(getStaffStore).toHaveBeenCalledWith(own, expect.anything());
    expect(createStoreDraftProduct).toHaveBeenCalledExactlyOnceWith(
      payload,
      actor,
      expect.any(String),
      own,
      headers['idempotency-key'],
    );
  });
});
