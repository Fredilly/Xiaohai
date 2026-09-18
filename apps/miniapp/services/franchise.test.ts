import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitFranchiseApplication } from './franchise';

describe('Mini Program M17 franchise service', () => {
  let requestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestMock = vi.fn((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          applicationNumber: 'FA-TEST',
          status: 'SUBMITTED',
          submittedAt: '2026-09-18T00:00:00.000Z',
        },
        statusCode: 201,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });
    (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      request: requestMock,
      getStorageSync: vi.fn(() => ''),
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { envVersion: 'develop' } })),
    } as unknown as WechatMiniprogram.Wx;
  });

  it('submits only public application fields and works anonymously', async () => {
    await submitFranchiseApplication({
      name: '测试申请人',
      phone: '13800000000',
      country: '中国',
      region: '四川省',
      city: '成都',
      message: '想了解加盟',
    });

    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.method).toBe('POST');
    expect(request.header).not.toHaveProperty('authorization');
    expect(request.data).toEqual({
      name: '测试申请人',
      phone: '13800000000',
      country: '中国',
      region: '四川省',
      city: '成都',
      message: '想了解加盟',
    });
    expect(request.data).not.toHaveProperty('status');
    expect(request.data).not.toHaveProperty('assignedStaffAccountId');
  });

  it('attaches Consumer Session only when one exists', async () => {
    (globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx.getStorageSync = vi.fn(
      () => 'consumer-token',
    ) as WechatMiniprogram.Wx['getStorageSync'];

    await submitFranchiseApplication({
      name: '测试申请人',
      phone: '13800000000',
      country: '中国',
      region: '四川省',
      city: '成都',
    });

    const request = requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption;
    expect(request.header).toMatchObject({ authorization: 'Bearer consumer-token' });
  });
});
