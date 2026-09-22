import { consumerToken, clearConsumerSession } from './consumer-session';
import type { RentalView } from '@xiaohai/contracts/rental';
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
export const createRental = (storeId: string, skuId: string) =>
  request<RentalView>('/api/v1/rentals', 'POST', {
    storeId,
    items: [{ skuId, quantity: 1 }],
    idempotencyKey: randomId(),
  });
export const listRentals = () => request<{ items: RentalView[] }>('/api/v1/rentals');
export const getRental = (id: string) => request<RentalView>(`/api/v1/rentals/${id}`);
export const cancelRental = (id: string) =>
  request<RentalView>(`/api/v1/rentals/${id}/cancel`, 'POST', { idempotencyKey: randomId() });
function randomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
