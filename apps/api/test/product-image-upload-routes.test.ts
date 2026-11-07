import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConsumerAuthError } from '../src/auth/errors.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../src/stores/store-service.js';
import {
  ProductImageError,
  type ProductImageUploadService,
} from '../src/commerce/product-image-upload-service.js';
import { registerProductImageUploadRoutes } from '../src/commerce/product-image-upload-routes.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const foreignId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const staffId = '44444444-4444-4444-8444-444444444444';
const payload = {
  expectedProductVersion: 0,
  mimeType: 'image/png',
  base64: 'aW1hZ2UtYnl0ZXM=',
};
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function makeApp(permissions: string[] = ['stores.read', 'catalog.edit'], global = false) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const upload = vi.fn().mockResolvedValue({
    imageId: '55555555-5555-4555-8555-555555555555',
    url: 'https://merchant-test.cd.bcebos.com/products/example.jpg',
    coverUrl: 'https://merchant-test.cd.bcebos.com/products/example.jpg',
    productVersion: 1,
    duplicate: false,
  });
  const getStaffStore = vi.fn((id: string) =>
    id === storeId
      ? Promise.resolve({ id })
      : Promise.reject(new StoreNetworkError('SCOPE_MISMATCH')),
  );
  registerProductImageUploadRoutes(app, {
    staffAuthorization: {
      authenticate: (header: string | undefined) =>
        header === 'Bearer test'
          ? Promise.resolve({ staffAccountId: staffId, permissions })
          : Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401)),
      requirePermission: (_actor: unknown, permission: string) => {
        if (!permissions.includes(permission)) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
      },
      requireDataScope: (_actor: unknown, type: string) => {
        if (!global || type !== 'GLOBAL') {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
      },
    } as unknown as StaffAuthorizationService,
    stores: { getStaffStore } as unknown as StoreNetworkService,
    images: { upload } as unknown as ProductImageUploadService,
  });
  return { app, upload, getStaffStore };
}

describe('Store and HQ merchant photo upload authorization (#208)', () => {
  const storePath = `/api/v1/staff/stores/${storeId}/catalog/products/${productId}/images`;
  const foreignPath = `/api/v1/staff/stores/${foreignId}/catalog/products/${productId}/images`;
  const hqPath = `/api/v1/staff/catalog/products/${productId}/images`;

  it('blocks missing session and malformed image content before service access', async () => {
    const { app, upload } = makeApp();
    const missing = await app.inject({ method: 'POST', url: storePath, payload });
    expect(missing.statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: storePath,
      headers: { authorization: 'Bearer test' },
      payload: { ...payload, mimeType: 'image/svg+xml' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('requires authentic store scope and catalog.edit', async () => {
    const { app, upload } = makeApp(['stores.read']);
    const headers = { authorization: 'Bearer test' };
    const denied = await app.inject({ method: 'POST', url: storePath, headers, payload });
    expect(denied.statusCode).toBe(403);
    const foreign = await app.inject({ method: 'POST', url: foreignPath, headers, payload });
    expect(foreign.statusCode).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes only server-approved Store scope and staff identity to upload service', async () => {
    const { app, upload } = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: storePath,
      headers: { authorization: 'Bearer test' },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    const call: unknown = upload.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      ...payload,
      productId,
      scopedStoreId: storeId,
      actorStaffAccountId: staffId,
    });
    expect(
      call !== null &&
        typeof call === 'object' &&
        'requestId' in call &&
        typeof call.requestId === 'string',
    ).toBe(true);
  });

  it('HQ route requires BOTH catalog.manage permission and GLOBAL data scope', async () => {
    const headers = { authorization: 'Bearer test' };
    const notGlobal = makeApp(['catalog.manage'], false);
    expect(
      (await notGlobal.app.inject({ method: 'POST', url: hqPath, headers, payload })).statusCode,
    ).toBe(403);
    const onlyGlobal = makeApp(['catalog.edit'], true);
    expect(
      (await onlyGlobal.app.inject({ method: 'POST', url: hqPath, headers, payload })).statusCode,
    ).toBe(403);
    const allowed = makeApp(['catalog.manage'], true);
    expect(
      (await allowed.app.inject({ method: 'POST', url: hqPath, headers, payload })).statusCode,
    ).toBe(201);
    expect(allowed.upload).toHaveBeenCalledWith(
      expect.objectContaining({ scopedStoreId: null, actorStaffAccountId: staffId }),
    );
  });

  it('redacts cross-store conflicts and unavailable media errors', async () => {
    const { app, upload } = makeApp();
    const headers = { authorization: 'Bearer test' };
    upload.mockRejectedValueOnce(new ProductImageError('SHARED_FORBIDDEN'));
    const denied = await app.inject({ method: 'POST', url: storePath, headers, payload });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'SHARED_FORBIDDEN' } });

    upload.mockRejectedValueOnce(new ProductImageError('MEDIA_UNAVAILABLE'));
    const unavailable = await app.inject({ method: 'POST', url: storePath, headers, payload });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('secret');
  });
});
