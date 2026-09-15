import { getApiBaseUrl } from '../config';
import type { PlaybackAccess, SeriesDetail, SeriesSummary } from '@xiaohai/contracts/content';
const token = () => String(wx.getStorageSync('consumer_session_token') || '');
async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: object): Promise<T> {
  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>((resolve, reject) => wx.request({ url: `${getApiBaseUrl()}${path}`, method, data, header: token() ? { Authorization: `Bearer ${token()}` } : {}, success: resolve, fail: reject }));
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Content API ${response.statusCode}`);
  return response.data as T;
}
export const listSeries = (q = '', category = '') => { const params = [q ? `q=${encodeURIComponent(q)}` : '', category ? `category=${encodeURIComponent(category)}` : ''].filter(Boolean).join('&'); return request<{ series: SeriesSummary[] }>(`/api/v1/content/series${params ? `?${params}` : ''}`); };
export const getSeries = (id: string) => request<SeriesDetail>(`/api/v1/content/series/${id}`);
export const getPlayback = (id: string) => request<PlaybackAccess>(`/api/v1/content/episodes/${id}/playback`);
export const saveProgress = (id: string, positionSeconds: number, completed: boolean) => request(`/api/v1/content/episodes/${id}/progress`, 'PUT', { positionSeconds, completed });
export const getContinueWatching = () => request<{ items: Array<{ series: SeriesSummary; episode: { id: string; title: string }; progress: { positionSeconds: number } }> }>('/api/v1/content/continue-watching');
export const getEntitlements = () => request<{ series: Array<SeriesSummary & { grantedAt: string }> }>('/api/v1/content/my-entitlements');
