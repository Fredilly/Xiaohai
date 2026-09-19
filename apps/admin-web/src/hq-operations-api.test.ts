import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHqFulfillment, loadHqInventory, loadHqRentals } from './hq-operations-api';

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
});
