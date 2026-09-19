import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInventory } from './inventory-api';
import { loadRentals } from './rental-api';
import { loadDeliveryZones, loadFulfillment } from './fulfillment-api';

const storeId = '11111111-1111-4111-8111-111111111111';

afterEach(() => vi.unstubAllGlobals());

describe('M19 current store scoping', () => {
  it('adds the selected store to inventory and rental queries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await loadInventory('staff-token', storeId);
    await loadRentals('staff-token', storeId);

    expect(fetchMock.mock.calls[0]?.[0]).toContain(`storeId=${storeId}`);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`storeId=${storeId}`);
  });

  it('adds the selected store to fulfillment and delivery-zone queries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await loadFulfillment('staff-token', storeId);
    await loadDeliveryZones('staff-token', storeId);

    expect(fetchMock.mock.calls[0]?.[0]).toContain(`storeId=${storeId}`);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`storeId=${storeId}`);
  });
});
