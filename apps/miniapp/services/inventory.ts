import type {
  InventoryAvailability,
  PublicInventoryItem,
  PublicInventoryQuery,
} from '@xiaohai/contracts/inventory';
import { getApiBaseUrl } from '../config';

export type InventoryQuery = Omit<PublicInventoryQuery, 'availability'> & {
  availability?: InventoryAvailability;
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
    throw new Error(`Inventory API ${response.statusCode}`);
  }
  return response.data as T;
}

function buildQuery(input: InventoryQuery) {
  const params: string[] = [];
  const append = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    params.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  append('q', input.q?.trim());
  append('availability', input.availability);
  append('storeId', input.storeId);
  append('regionId', input.regionId);
  append('city', input.city?.trim());
  append('latitude', input.latitude);
  append('longitude', input.longitude);
  append('radiusKm', input.radiusKm);
  append('limit', input.limit);
  return params.length ? `?${params.join('&')}` : '';
}

export const searchInventory = (query: InventoryQuery = {}) =>
  request<{ items: PublicInventoryItem[] }>(`/api/v1/inventory/books${buildQuery(query)}`).then(
    (result) => result.items,
  );
