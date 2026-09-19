import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaffStores } from './stores-api';

const store = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'CD-NANMEN',
  name: '胖竹书店南门店',
  region: {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'CN-SC',
    name: '四川',
    countryCode: 'CN',
    countryName: '中国',
  },
  franchisee: null,
  countryCode: 'CN',
  countryName: '中国',
  city: '成都',
  timezone: 'Asia/Shanghai',
  addressLine: '测试地址',
  latitude: 30.6,
  longitude: 104.0,
  phone: null,
  openingHoursText: null,
  services: ['SALE', 'RENTAL'],
  operationalStatus: 'ACTIVE',
  distanceKm: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('M19 store context adapter', () => {
  it('loads only the staff stores returned by the scoped API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ stores: [store] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadStaffStores('staff-token');

    expect(result.stores).toHaveLength(1);
    expect(result.stores[0]?.name).toBe('胖竹书店南门店');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/stores');
    expect(init.headers).toMatchObject({ authorization: 'Bearer staff-token' });
  });
});
