import { consumerToken, clearConsumerSession } from './consumer-session';
import type {
  FulfillmentMethod,
  FulfillmentQuote,
  FulfillmentView,
} from '@xiaohai/contracts/fulfillment';
import { getApiBaseUrl } from '../config';

const token = consumerToken;

async function request<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  data?: unknown,
): Promise<T> {
  const session = token();
  if (!session) throw new Error('AUTH_REQUIRED');
  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) =>
      wx.request({
        timeout: 10000,
        url: `${getApiBaseUrl()}${path}`,
        method,
        data: data as WechatMiniprogram.IAnyObject | undefined,
        header: { authorization: `Bearer ${session}` },
        success: resolve,
        fail: reject,
      }),
  );
  if (response.statusCode === 401) clearConsumerSession();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = response.data as { error?: { code?: string } };
    throw new Error(body?.error?.code ?? `HTTP_${response.statusCode}`);
  }
  return response.data as T;
}

export const quoteFulfillment = (method: FulfillmentMethod, storeId: string, addressId?: string) =>
  request<FulfillmentQuote>('/api/v1/fulfillment/quote', 'POST', {
    method,
    storeId,
    ...(method === 'DELIVERY' && addressId ? { addressId } : {}),
  });

export const createFulfillmentOrder = (
  method: FulfillmentMethod,
  storeId: string,
  clientRequestId: string,
  addressId?: string,
) => {
  const referralCode = String(wx.getStorageSync('referral_code') || '');
  return request<{ orderId: string }>('/api/v1/fulfillment/orders', 'POST', {
    method,
    storeId,
    clientRequestId,
    ...(/^[A-Z0-9_-]{8,32}$/.test(referralCode) ? { referralCode } : {}),
    ...(method === 'DELIVERY' && addressId ? { addressId } : {}),
  }).then((result) => {
    if (/^[A-Z0-9_-]{8,32}$/.test(referralCode)) wx.removeStorageSync('referral_code');
    return result;
  });
};

export const getFulfillment = (orderId: string) =>
  request<FulfillmentView>(`/api/v1/fulfillment/orders/${orderId}`);

export function randomClientRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
