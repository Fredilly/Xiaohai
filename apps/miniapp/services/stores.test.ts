import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listStores } from './stores';

describe('Mini Program M12 store service', () => {
  let requestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();

    requestMock = vi.fn();

    (
      globalThis as typeof globalThis & {
        wx: WechatMiniprogram.Wx;
      }
    ).wx = {
      request: requestMock,
      getAccountInfoSync: vi.fn(() => ({
        miniProgram: {
          envVersion: 'develop',
        },
      })),
    } as unknown as WechatMiniprogram.Wx;
  });

  it('encodes store filters and forwards a bounded limit', async () => {
    requestMock.mockImplementation((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: { stores: [] },
        statusCode: 200,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });

    await listStores({
      q: '胖竹 南门',
      city: '成都',
      service: '阅读',
      latitude: 30.65,
      longitude: 104.06,
      radiusKm: 50,
      limit: 25,
    });

    expect(requestMock).toHaveBeenCalledTimes(1);

    const url =
      (requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption | undefined)?.url ?? '';
    expect(url).toContain('/api/v1/stores?');
    expect(url).toContain('q=%E8%83%96%E7%AB%B9%20%E5%8D%97%E9%97%A8');
    expect(url).toContain('city=%E6%88%90%E9%83%BD');
    expect(url).toContain('service=%E9%98%85%E8%AF%BB');
    expect(url).toContain('latitude=30.65');
    expect(url).toContain('longitude=104.06');
    expect(url).toContain('radiusKm=50');
    expect(url).toContain('limit=25');
  });

  it('throws when the store API returns a non-2xx response', async () => {
    requestMock.mockImplementation((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: {},
        statusCode: 500,
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      });
      return {} as WechatMiniprogram.RequestTask;
    });

    await expect(listStores()).rejects.toThrow('Store API 500');
  });
});
