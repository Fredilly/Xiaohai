import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRental, listRentals } from './rental';

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
    storageMock = vi.fn(() => 'consumer-token');
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
  it('requires a stored session', async () => {
    storageMock.mockReturnValue('');
    await expect(listRentals()).rejects.toThrow('AUTH_REQUIRED');
  });
});
