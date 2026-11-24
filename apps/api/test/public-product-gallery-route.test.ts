import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerCommerceRoutes } from '../src/commerce/commerce-routes.js';
import type { CommerceService } from '../src/commerce/commerce-service.js';
import type { ConsumerSessionService } from '../src/auth/session.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';

const id = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('public catalog detail merchant photo gallery contract (#208)', () => {
  it('returns ordered photos to consumers while preserving the existing SKU fields', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    const getProduct = vi.fn(() =>
      Promise.resolve({
        id,
        name: '门店曲奇饼干',
        description: '商家真实商品',
        coverUrl: 'https://assets.example.com/merchant/cover.jpg',
        mediaUrls: [
          'https://assets.example.com/merchant/side.jpg',
          'https://assets.example.com/merchant/back.jpg',
        ],
        title: null,
        author: null,
        isbn: null,
        publisher: null,
        skus: [
          { id: skuId, code: 'COOKIE', name: '100克', priceMinor: 1980, availableForSale: true },
        ],
      }),
    );
    registerCommerceRoutes(app, {
      commerce: { getProduct } as unknown as CommerceService,
      consumerSessions: {} as ConsumerSessionService,
      staffAuthorization: {} as StaffAuthorizationService,
    });
    const response = await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: '门店曲奇饼干',
      mediaUrls: [
        'https://assets.example.com/merchant/side.jpg',
        'https://assets.example.com/merchant/back.jpg',
      ],
      skus: [{ priceMinor: 1980, availableForSale: true }],
    });
    expect(getProduct).toHaveBeenCalledOnce();
  });

  it('accepts the previous response contract when a product has no gallery yet', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    const getProduct = vi.fn(() =>
      Promise.resolve({
        id,
        name: '店内商品',
        description: null,
        coverUrl: null,
        title: null,
        author: null,
        isbn: null,
        publisher: null,
        skus: [],
      }),
    );
    registerCommerceRoutes(app, {
      commerce: { getProduct } as unknown as CommerceService,
      consumerSessions: {} as ConsumerSessionService,
      staffAuthorization: {} as StaffAuthorizationService,
    });
    const response = await app.inject({ method: 'GET', url: `/api/v1/catalog/products/${id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('mediaUrls');
  });
});
