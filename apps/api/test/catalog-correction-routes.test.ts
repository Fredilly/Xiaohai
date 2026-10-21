import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import { StoreNetworkError } from '../src/stores/store-service.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import type { StoreNetworkService } from '../src/stores/store-service.js';
import { registerCatalogCorrectionRoutes } from '../src/commerce/catalog-correction-routes.js';
import type { CatalogCorrectionService } from '../src/commerce/catalog-correction-service.js';

const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const skuId = '33333333-3333-4333-8333-333333333333';
const actor = '44444444-4444-4444-8444-444444444444';
const correctionId = '55555555-5555-4555-8555-555555555555';
const authorization = ['Be', 'arer ', 'fake-staff-token'].join('');
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(permissions: string[]) {
  const app = Fastify();
  apps.push(app);
  const context = {
    staffAccountId: actor,
    loginIdentifier: 'test.staff',
    permissions,
    dataScopes: [{ type: 'STORE' as const, id: own }],
  };
  const submit = vi.fn(() => Promise.resolve({ id: correctionId, status: 'PENDING' }));
  const review = vi.fn(() => Promise.resolve({ id: correctionId, status: 'ACCEPTED' }));
  const list = vi.fn(() => Promise.resolve({ requests: [] }));
  registerCatalogCorrectionRoutes(app, {
    staffAuthorization: {
      authenticate: (header: string | undefined) => {
        if (header !== authorization) {
          return Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401));
        }
        return Promise.resolve(context);
      },
      requirePermission: (staff: typeof context, key: string) => {
        if (!staff.permissions.includes(key)) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
      },
      hasPermission: (staff: typeof context, key: string) => staff.permissions.includes(key),
    } as unknown as StaffAuthorizationService,
    stores: {
      getStaffStore: (id: string) => {
        if (id !== own) return Promise.reject(new StoreNetworkError('SCOPE_MISMATCH'));
        return Promise.resolve({ id });
      },
    } as unknown as StoreNetworkService,
    corrections: { submit, review, list } as unknown as CatalogCorrectionService,
  });
  return { app, submit, review, list };
}

describe('daily catalog corrections remain scoped and separately authorized', () => {
  const createBody = {
    skuId,
    expectedInventoryVersion: 2,
    field: 'bookTitle',
    proposedValue: '应更正的书名',
    reason: '依据书籍封面核对',
  };

  it('does not accept an unauthenticated submission', async () => {
    const { app, submit } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections',
      payload: createBody,
    });
    expect(response.statusCode).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects unauthorized store without calling proposal writes', async () => {
    const { app, submit } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + other + '/catalog-corrections',
      headers: { authorization },
      payload: createBody,
    });
    expect(response.statusCode).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not give review access to ordinary inventory managers', async () => {
    const { app, review } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections/' + correctionId + '/review',
      headers: { authorization },
      payload: { verdict: 'ACCEPTED', reason: '复核确认' },
    });
    expect(response.statusCode).toBe(403);
    expect(review).not.toHaveBeenCalled();
  });

  it('allows scoped managers to submit a validated proposal, never direct catalog update', async () => {
    const { app, submit } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections',
      headers: { authorization },
      payload: createBody,
    });
    expect(response.statusCode).toBe(201);
    expect(submit).toHaveBeenCalledWith(own, actor, expect.any(String), createBody);
  });

  it('rejects invalid proposed minor-unit price', async () => {
    const { app, submit } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections',
      headers: { authorization },
      payload: { ...createBody, field: 'priceMinor', proposedValue: '-100' },
    });
    expect(response.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects SKU price proposals beyond the supported integer minor-unit range', async () => {
    const { app, submit } = setup(['stores.read', 'inventory.read', 'inventory.stocktake']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections',
      headers: { authorization },
      payload: {
        ...createBody,
        field: 'priceMinor',
        proposedValue: '2147483648',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('lets authorized independent reviewers decide scoped proposals', async () => {
    const { app, review, list } = setup(['stores.read', 'catalog.correction.review']);
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections',
      headers: { authorization },
    });
    expect(read.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(own);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores/' + own + '/catalog-corrections/' + correctionId + '/review',
      headers: { authorization },
      payload: { verdict: 'ACCEPTED', reason: '复核确认' },
    });
    expect(response.statusCode).toBe(200);
    expect(review).toHaveBeenCalledWith(own, correctionId, actor, expect.any(String), {
      verdict: 'ACCEPTED',
      reason: '复核确认',
    });
  });
});
