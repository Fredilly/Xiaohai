import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelRental, createRental, listRentals } from './rental';

describe('Mini Program M15 rental service', () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let storageMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    requestMock = vi.fn((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: { items: [] },
        statusCode: 200,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    storageMock = vi.fn((key: string) =>
      key === 'consumer_session_expires_at'
        ? new Date(Date.now() + 60_000).toISOString()
        : 'consumer-token',
    );
    (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      request: requestMock,
      getStorageSync: storageMock,
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { envVersion: 'develop' } })),
    } as unknown as WechatMiniprogram.Wx;
  });
  it('uses the Consumer Session and never sends server-controlled rental fields', async () => {
    requestMock.mockImplementation((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: { id: 'rental' },
        statusCode: 201,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    await createRental(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.header).toMatchObject({ authorization: 'Bearer consumer-token' });
    expect(request.data).toMatchObject({ items: [{ quantity: 1 }] });
    expect(request.data).not.toHaveProperty('status');
    expect(request.data).not.toHaveProperty('dueAt');
  });
  it('passes a caller-supplied idempotency key unchanged on rental retry', async () => {
    const requestKey = '55555555-5555-4555-8555-555555555555';
    await createRental(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      requestKey,
    );
    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.data).toMatchObject({ idempotencyKey: requestKey });
  });
  it('replays an explicit cancellation idempotency key without substituting a new one', async () => {
    const requestKey = '55555555-5555-4555-8555-555555555555';
    await cancelRental('33333333-3333-4333-8333-333333333333', requestKey);
    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.method).toBe('POST');
    expect(request.url).toContain('/rentals/33333333-3333-4333-8333-333333333333/cancel');
    expect(request.data).toMatchObject({ idempotencyKey: requestKey });
  });
  it('requires a stored session', async () => {
    storageMock.mockReturnValue('');
    await expect(listRentals()).rejects.toThrow('AUTH_REQUIRED');
  });
});
