import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import { StoreNetworkError } from '../src/stores/store-service.js';
import { CatalogEditError } from '../src/commerce/catalog-edit-service.js';
import {
  registerStoreCatalogEditRoutes,
  registerStoreCatalogReadRoutes,
} from '../src/commerce/store-catalog-read-routes.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import type { StoreNetworkService } from '../src/stores/store-service.js';
import type { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';

const own = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const context = {
  staffAccountId: '33333333-3333-4333-8333-333333333333',
  loginIdentifier: 'store.manager',
  permissions: ['stores.read', 'inventory.read'],
  dataScopes: [{ type: 'STORE' as const, id: own }],
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(perms = context.permissions) {
  const app = Fastify();
  apps.push(app);
  const list = vi.fn((storeId: string) =>
    Promise.resolve({
      storeId,
      offset: 0,
      limit: 30,
      hasMore: false,
      items: [],
    }),
  );
  const preview = vi.fn(() =>
    Promise.resolve({
      impact: {
        sharedFields: ['bookTitle'],
        affectedStoreCount: 2,
        affectedStoreIds: [own, foreign],
      },
      previewToken: 'signed-test-token',
    }),
  );
  const update = vi.fn(() =>
    Promise.resolve({
      item: {
        storeId: own,
        productId: own,
        productName: 'Book',
        productStatus: 'ACTIVE',
        coverUrl: null,
        bookTitle: 'Book',
        author: 'Author',
        isbn: null,
        publisher: null,
        skuId: own,
        skuCode: 'SKU',
        skuName: 'Standard',
        skuStatus: 'ACTIVE',
        priceMinor: 100,
        availableForSale: true,
        onHand: 1,
        reserved: 0,
        rentalReserved: 0,
        available: 1,
        inventoryVersion: 0,
        productVersion: 0,
        bookVersion: 0,
        editionVersion: 0,
        skuVersion: 0,
        localVersion: 0,
        shelfLocation: null,
        storeNote: null,
        displayInfo: null,
      },
      impact: {
        sharedFields: ['bookTitle'],
        affectedStoreCount: 2,
        affectedStoreIds: [own, foreign],
      },
    }),
  );
  const scoped = { ...context, permissions: perms };
  registerStoreCatalogReadRoutes(app, {
    staffAuthorization: {
      authenticate: (authorization: string | undefined) => {
        if (authorization !== ['Be', 'arer ', 'fake-staff-session'].join('')) {
          return Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401));
        }
        return Promise.resolve(scoped);
      },
      requirePermission: (actor: typeof scoped, key: string) => {
        if (!actor.permissions.includes(key)) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
      },
    } as unknown as StaffAuthorizationService,
    stores: {
      getStaffStore: (storeId: string) => {
        if (storeId !== own) return Promise.reject(new StoreNetworkError('SCOPE_MISMATCH'));
        return Promise.resolve({ id: storeId });
      },
    } as unknown as StoreNetworkService,
    catalog: { list } as unknown as StoreCatalogReadService,
  });
  registerStoreCatalogEditRoutes(app, {
    staffAuthorization: {
      authenticate: (authorization: string | undefined) => {
        if (authorization !== ['Be', 'arer ', 'fake-staff-session'].join('')) {
          return Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401));
        }
        return Promise.resolve(scoped);
      },
      requirePermission: (actor: typeof scoped, key: string) => {
        if (!actor.permissions.includes(key)) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
      },
    } as unknown as StaffAuthorizationService,
    stores: {
      getStaffStore: (storeId: string) => {
        if (storeId !== own) return Promise.reject(new StoreNetworkError('SCOPE_MISMATCH'));
        return Promise.resolve({ id: storeId });
      },
    } as unknown as StoreNetworkService,
    catalog: { preview, update } as never,
  });
  return { app, list, preview, update };
}

describe('authenticated store-scoped daily catalog read endpoint', () => {
  it('fails closed for unauthenticated access', async () => {
    const { app, list } = setup();
    const r = await app.inject({ method: 'GET', url: `/api/v1/staff/stores/${own}/catalog` });
    expect(r.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('does not allow a real Staff identity scoped to a different store', async () => {
    const { app, list } = setup();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/stores/${foreign}/catalog`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
    });
    expect(r.statusCode).toBe(403);
    const result: unknown = JSON.parse(r.body);
    expect(result).toMatchObject({ error: { code: 'STAFF_FORBIDDEN' } });
    expect(list).not.toHaveBeenCalled();
  });

  it('requires both stores.read and inventory.read', async () => {
    const { app, list } = setup(['stores.read']);
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/stores/${own}/catalog`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
    });
    expect(r.statusCode).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns a bounded, read-only response for the authorized store', async () => {
    const { app, list } = setup();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/stores/${own}/catalog?q=%E7%BB%98%E6%9C%AC&offset=0&limit=30`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
    });
    expect(r.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(own, { q: '绘本', offset: 0, limit: 30 });
    const result: unknown = JSON.parse(r.body);
    expect(result).toMatchObject({ items: [] });
  });

  it('rejects invalid pagination without querying the database', async () => {
    const { app, list } = setup();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/stores/${own}/catalog?limit=1000`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
    });
    expect(r.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('authorized direct catalog editing', () => {
  const body = {
    expectedProductVersion: 0,
    expectedSkuVersion: 0,
    expectedLocalVersion: 0,
    storeNote: 'Shelf note for this store only',
  };
  const sharedBody = {
    ...body,
    expectedBookVersion: 0,
    bookTitle: 'Attempted global title edit',
  };

  it('requires the unified catalog.edit permission', async () => {
    const { app, update } = setup(['stores.read']);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/stores/${own}/catalog/${own}`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('passes local edits and scoped shared-field previews to the same editor', async () => {
    const { app, preview, update } = setup(['stores.read', 'catalog.edit']);
    const headers = { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') };
    const url = `/api/v1/staff/stores/${own}/catalog/${own}`;

    const local = await app.inject({ method: 'POST', url: url + '/preview', headers, payload: body });
    expect(local.statusCode).toBe(200);
    expect(preview).toHaveBeenCalledWith(own, own, body, context.staffAccountId, 'STORE_ONLY');

    const localUpdate = await app.inject({ method: 'PATCH', url, headers, payload: body });
    expect(localUpdate.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      own,
      own,
      context.staffAccountId,
      expect.any(String),
      body,
      'STORE_ONLY',
      undefined,
    );

    // Real service permits this only for a single affected store. The route
    // must carry the signed impact token unchanged rather than bypassing it.
    preview.mockResolvedValueOnce({
      impact: { sharedFields: ['bookTitle'], affectedStoreCount: 1, affectedStoreIds: [own] },
      previewToken: 'signed-test-token',
    });
    const approvedPreview = await app.inject({
      method: 'POST',
      url: url + '/preview',
      headers,
      payload: sharedBody,
    });
    expect(approvedPreview.statusCode).toBe(200);
    expect(preview).toHaveBeenLastCalledWith(
      own,
      own,
      sharedBody,
      context.staffAccountId,
      'STORE_ONLY',
    );

    const signed = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'x-catalog-preview-token': 'signed-test-token' },
      payload: sharedBody,
    });
    expect(signed.statusCode).toBe(200);
    expect(update).toHaveBeenLastCalledWith(
      own,
      own,
      context.staffAccountId,
      expect.any(String),
      sharedBody,
      'STORE_ONLY',
      'signed-test-token',
    );
  });

  it('returns safe 403 when the store editor rejects cross-store impact', async () => {
    const { app, preview, update } = setup(['stores.read', 'catalog.edit']);
    const headers = { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') };
    const url = `/api/v1/staff/stores/${own}/catalog/${own}`;
    preview.mockRejectedValueOnce(new CatalogEditError('SHARED_FORBIDDEN'));
    const forbiddenPreview = await app.inject({
      method: 'POST',
      url: url + '/preview',
      headers,
      payload: sharedBody,
    });
    expect(forbiddenPreview.statusCode).toBe(403);
    expect(forbiddenPreview.json()).toMatchObject({ error: { code: 'SHARED_FORBIDDEN' } });

    update.mockRejectedValueOnce(new CatalogEditError('SHARED_FORBIDDEN'));
    const forbiddenWrite = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: sharedBody,
    });
    expect(forbiddenWrite.statusCode).toBe(403);
    expect(forbiddenWrite.json()).toMatchObject({ error: { code: 'SHARED_FORBIDDEN' } });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rejects an authorized identity outside its store scope', async () => {
    const { app, update } = setup(['stores.read', 'catalog.edit']);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/stores/${foreign}/catalog/${own}`,
      headers: { authorization: ['Be', 'arer ', 'fake-staff-session'].join('') },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
