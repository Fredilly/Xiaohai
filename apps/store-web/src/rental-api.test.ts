import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rentalAction } from './rental-api';

const rentalId = '55555555-5555-4555-8555-555555555555';
const storeId = '33333333-3333-4333-8333-333333333333';
const requestKey = '66666666-6666-4666-8666-666666666666';
const view = {
  id: rentalId,
  consumerUserId: '11111111-1111-4111-8111-111111111111',
  storeId,
  storeName: '东门',
  rentalNumber: 'RN-001',
  status: 'BORROWED',
  version: 1,
  reservedAt: '2026-01-01T00:00:00.000Z',
  borrowedAt: null,
  dueAt: null,
  returnedAt: null,
  cancelledAt: null,
  isOverdue: false,
  pickupCode: null,
  items: [],
  events: [],
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(view) });
});

describe('staff rental actions require stable request identity', () => {
  it('passes the exact caller key and pickup code to the authorized borrow endpoint', async () => {
    const result = await rentalAction('staff-token', rentalId, 'borrow', requestKey, '123456');
    expect(result.id).toBe(rentalId);
    expect(result.reservedAt).toBeInstanceOf(Date);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/staff/rentals/${rentalId}/borrow`);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ authorization: 'Bearer staff-token' });
    expect(JSON.parse(options.body as string)).toEqual({
      idempotencyKey: requestKey,
      pickupCode: '123456',
    });
  });

  it('refuses an absent replay key before any network write', async () => {
    await expect(rentalAction('staff-token', rentalId, 'return', '')).rejects.toThrow(
      'RENTAL_ACTION_KEY_REQUIRED',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an incomplete server response instead of treating it as confirmed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: rentalId }) });
    await expect(rentalAction('staff-token', rentalId, 'return', requestKey)).rejects.toThrow();
  });
});
