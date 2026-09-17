import type { PublicRegion, PublicStore } from '@xiaohai/contracts/stores';
import { getApiBaseUrl } from '../config';

type StoreQuery = {
  q?: string;
  country?: string;
  city?: string;
  regionId?: string;
  service?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
};

async function request<T>(path: string): Promise<T> {
  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) =>
      wx.request({
        url: `${getApiBaseUrl()}${path}`,
        method: 'GET',
        success: resolve,
        fail: reject,
      }),
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Store API ${response.statusCode}`);
  }
  return response.data as T;
}

function buildQuery(input: StoreQuery) {
  const params: string[] = [];
  const append = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  append('q', input.q?.trim());
  append('country', input.country?.trim());
  append('city', input.city?.trim());
  append('regionId', input.regionId);
  append('service', input.service?.trim());
  append('latitude', input.latitude);
  append('longitude', input.longitude);
  append('radiusKm', input.radiusKm);
  return params.length ? `?${params.join('&')}` : '';
}

export const listRegions = () =>
  request<{ regions: PublicRegion[] }>('/api/v1/regions').then((result) => result.regions);

export const listStores = (query: StoreQuery = {}) =>
  request<{ stores: PublicStore[] }>(`/api/v1/stores${buildQuery(query)}`).then(
    (result) => result.stores,
  );

export const getStore = (id: string) => request<PublicStore>(`/api/v1/stores/${id}`);
