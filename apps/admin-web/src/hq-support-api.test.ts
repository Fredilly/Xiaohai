import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHqOrder, loadHqOrders, loadHqUser, loadHqUsers } from './hq-support-api';

afterEach(() => vi.unstubAllGlobals());

const orderId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const order = {
  id: orderId,
  orderNumber: 'XH-TEST',
  consumerUserId: userId,
  status: 'PAID',
  subtotalMinor: 1000,
  totalMinor: 1000,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:01:00.000Z',
};

const user = {
  id: userId,
  identityCount: 1,
  lastLoginAt: '2026-09-19T00:00:00.000Z',
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
};

describe('M20 HQ support adapters', () => {
  it('sends authenticated order filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [order] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadHqOrders('staff-token', { status: 'PAID', q: 'XH-TEST', limit: 20 });

    expect(result.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/orders?');
    expect(url).toContain('status=PAID');
    expect(url).toContain('q=XH-TEST');
    expect(url).toContain('limit=20');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
  });

  it('loads order detail from the HQ endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...order,
        address: null,
        items: [],
        payment: null,
        fulfillment: null,
        cancelledAt: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadHqOrder('staff-token', orderId);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(`/api/v1/staff/orders/${orderId}`);
  });

  it('loads minimized consumer support records without provider identifiers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [user] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadHqUsers('staff-token', { id: userId, limit: 10 });

    expect(result.items[0]).toEqual(user);
    expect(result.items[0]).not.toHaveProperty('openid');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`/api/v1/staff/users?id=${userId}`);
  });

  it('loads aggregate user detail only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...user,
        orderCount: 2,
        lifetimeOrderMinor: 2300,
        lastOrderAt: '2026-09-19T00:00:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadHqUser('staff-token', userId);
    expect(result.orderCount).toBe(2);
    expect(result).not.toHaveProperty('openid');
  });
});
