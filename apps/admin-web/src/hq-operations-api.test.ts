import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHqPurchaseOrder,
  createHqSupplier,
  loadHqFulfillment,
  loadHqInventory,
  loadHqRentals,
} from './hq-operations-api';

afterEach(() => vi.unstubAllGlobals());

describe('M20 HQ operations adapter', () => {
  it('sends staff auth and store filter to inventory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const storeId = '11111111-1111-4111-8111-111111111111';
    const result = await loadHqInventory('staff-token', storeId);

    expect(result.items).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/staff/inventory?storeId=${storeId}`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
  });

  it('uses real rental and fulfillment staff endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadHqRentals('staff-token');
    await loadHqFulfillment('staff-token');

    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/staff/rentals');
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/api/v1/staff/fulfillment');
  });

  it('creates a supplier through the protected Staff endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        code: 'SUP-1',
        name: '测试供应商',
        contactName: null,
        email: null,
        phone: null,
        status: 'ACTIVE',
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createHqSupplier('staff-token', { code: 'SUP-1', name: '测试供应商' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/inventory/suppliers');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer staff-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({ code: 'SUP-1', name: '测试供应商' });
  });

  it('keeps purchase order store and item input server-validated', async () => {
    const supplierId = '22222222-2222-4222-8222-222222222222';
    const storeId = '11111111-1111-4111-8111-111111111111';
    const skuId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        orderNumber: 'PO-TEST',
        supplierId,
        storeId,
        status: 'DRAFT',
        notes: null,
        expectedAt: null,
        createdByStaffAccountId: '55555555-5555-4555-8555-555555555555',
        submittedAt: null,
        cancelledAt: null,
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
        items: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            purchaseOrderId: '44444444-4444-4444-8444-444444444444',
            skuId,
            orderedQuantity: 2,
            receivedQuantity: 0,
            unitCostMinor: 1200,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createHqPurchaseOrder('staff-token', {
      supplierId,
      storeId,
      items: [{ skuId, quantity: 2, unitCostMinor: 1200 }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      supplierId,
      storeId,
      items: [{ skuId, quantity: 2, unitCostMinor: 1200 }],
    });
  });
});
