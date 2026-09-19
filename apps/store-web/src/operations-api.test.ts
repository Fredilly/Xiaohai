import { afterEach, describe, expect, it, vi } from 'vitest';
import { actOnPurchaseOrder, createStockTransfer, loadInventoryAlerts } from './operations-api';

afterEach(() => vi.unstubAllGlobals());

describe('M19 store operations adapter', () => {
  it('scopes low-stock alerts to the selected store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ alerts: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadInventoryAlerts('staff-token', '11111111-1111-4111-8111-111111111111', 3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      '/api/v1/staff/inventory/stores/11111111-1111-4111-8111-111111111111/alerts?threshold=3',
    );
    expect(init.headers).toMatchObject({ authorization: 'Bearer staff-token' });
  });

  it('sends server-defined purchase order actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        orderNumber: 'PO-1',
        supplierId: '22222222-2222-4222-8222-222222222222',
        storeId: '33333333-3333-4333-8333-333333333333',
        status: 'SUBMITTED',
        notes: null,
        expectedAt: null,
        createdByStaffAccountId: '44444444-4444-4444-8444-444444444444',
        submittedAt: '2026-09-19T00:00:00.000Z',
        cancelledAt: null,
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await actOnPurchaseOrder('staff-token', '11111111-1111-4111-8111-111111111111', 'SUBMIT');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/inventory/purchase-orders/11111111-1111-4111-8111-111111111111/actions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'SUBMIT' });
  });

  it('keeps transfer source and destination explicit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        transferNumber: 'TR-1',
        sourceStoreId: '22222222-2222-4222-8222-222222222222',
        destinationStoreId: '33333333-3333-4333-8333-333333333333',
        status: 'DRAFT',
        notes: null,
        createdByStaffAccountId: '44444444-4444-4444-8444-444444444444',
        submittedAt: null,
        dispatchedAt: null,
        receivedAt: null,
        cancelledAt: null,
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
        items: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            stockTransferId: '11111111-1111-4111-8111-111111111111',
            skuId: '66666666-6666-4666-8666-666666666666',
            quantity: 2,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createStockTransfer('staff-token', {
      sourceStoreId: '22222222-2222-4222-8222-222222222222',
      destinationStoreId: '33333333-3333-4333-8333-333333333333',
      items: [{ skuId: '66666666-6666-4666-8666-666666666666', quantity: 2 }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      sourceStoreId: '22222222-2222-4222-8222-222222222222',
      destinationStoreId: '33333333-3333-4333-8333-333333333333',
    });
  });
});
