import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFulfillmentOrder, getFulfillment, quoteFulfillment } from './fulfillment';

describe('Mini Program M16 fulfillment service', () => {
  let requestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestMock = vi.fn((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: {},
        statusCode: 200,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      request: requestMock,
      getStorageSync: vi.fn(() => 'consumer-token'),
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { envVersion: 'develop' } })),
    } as unknown as WechatMiniprogram.Wx;
  });

  it('sends delivery selection but never sends server-controlled fees or provider data', async () => {
    await quoteFulfillment(
      'DELIVERY',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.header).toMatchObject({ authorization: 'Bearer consumer-token' });
    expect(request.data).toEqual({
      method: 'DELIVERY',
      storeId: '11111111-1111-4111-8111-111111111111',
      addressId: '22222222-2222-4222-8222-222222222222',
    });
    expect(request.data).not.toHaveProperty('deliveryFeeMinor');
    expect(request.data).not.toHaveProperty('providerKey');
  });

  it('keeps pickup addressless and reuses the supplied idempotency key', async () => {
    await createFulfillmentOrder(
      'PICKUP',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    );
    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.data).toEqual({
      method: 'PICKUP',
      storeId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('requires the Consumer Session before loading fulfillment details', async () => {
    (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx.getStorageSync = vi.fn(
      () => '',
    ) as WechatMiniprogram.Wx['getStorageSync'];
    await expect(getFulfillment('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'AUTH_REQUIRED',
    );
  });
});
