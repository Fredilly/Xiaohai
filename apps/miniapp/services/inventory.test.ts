import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchInventory } from './inventory';

describe('Mini Program M13 inventory service', () => {
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

  it('encodes inventory search and nearby filters', async () => {
    requestMock.mockImplementation((options: WechatMiniprogram.RequestOption) => {
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

    await searchInventory({
      q: '小海 ISBN',
      availability: 'SALE',
      city: '成都',
      latitude: 30.65,
      longitude: 104.06,
      radiusKm: 50,
      limit: 25,
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const url =
      (requestMock.mock.calls[0]?.[0] as WechatMiniprogram.RequestOption | undefined)?.url ?? '';
    expect(url).toContain('/api/v1/inventory/books?');
    expect(url).toContain('q=%E5%B0%8F%E6%B5%B7%20ISBN');
    expect(url).toContain('availability=SALE');
    expect(url).toContain('city=%E6%88%90%E9%83%BD');
    expect(url).toContain('latitude=30.65');
    expect(url).toContain('longitude=104.06');
    expect(url).toContain('radiusKm=50');
    expect(url).toContain('limit=25');
  });

  it('throws when the inventory API returns a non-2xx response', async () => {
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

    await expect(searchInventory()).rejects.toThrow('Inventory API 500');
  });
});
