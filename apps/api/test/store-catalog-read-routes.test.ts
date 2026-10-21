import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import { StoreNetworkError } from '../src/stores/store-service.js';
import { registerStoreCatalogReadRoutes } from '../src/commerce/store-catalog-read-routes.js';
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
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(perms = context.permissions) {
  const app = Fastify();
  apps.push(app);
  const list = vi.fn(async (storeId: string) => ({
    storeId, offset: 0, limit: 30, hasMore: false, items: [],
  }));
  const scoped = { ...context, permissions: perms };
  registerStoreCatalogReadRoutes(app, {
    staffAuthorization: {
      authenticate: async (authorization: string | undefined) => {
        if (authorization !== 'Bearer fake-staff-session') {
          throw new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401);
        }
        return scoped;
      },
      requirePermission: (actor: typeof scoped, key: string) => {
        if (!actor.permissions.includes(key)) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
      },
    } as unknown as StaffAuthorizationService,
    stores: {
      getStaffStore: async (storeId: string) => {
        if (storeId !== own) throw new StoreNetworkError('SCOPE_MISMATCH');
        return { id: storeId };
      },
    } as unknown as StoreNetworkService,
    catalog: { list } as unknown as StoreCatalogReadService,
  });
  return { app, list };
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
      method: 'GET', url: `/api/v1/staff/stores/${foreign}/catalog`,
      headers: { authorization: 'Bearer fake-staff-session' },
    });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error.code).toBe('STAFF_FORBIDDEN');
    expect(list).not.toHaveBeenCalled();
  });

  it('requires both stores.read and inventory.read', async () => {
    const { app, list } = setup(['stores.read']);
    const r = await app.inject({
      method: 'GET', url: `/api/v1/staff/stores/${own}/catalog`,
      headers: { authorization: 'Bearer fake-staff-session' },
    });
    expect(r.statusCode).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns a bounded, read-only response for the authorized store', async () => {
    const { app, list } = setup();
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/stores/${own}/catalog?q=%E7%BB%98%E6%9C%AC&offset=0&limit=30`,
      headers: { authorization: 'Bearer fake-staff-session' },
    });
    expect(r.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(own, { q: '绘本', offset: 0, limit: 30 });
    expect(JSON.parse(r.body).items).toEqual([]);
  });

  it('rejects invalid pagination without querying the database', async () => {
    const { app, list } = setup();
    const r = await app.inject({
      method: 'GET', url: `/api/v1/staff/stores/${own}/catalog?limit=1000`,
      headers: { authorization: 'Bearer fake-staff-session' },
    });
    expect(r.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});
