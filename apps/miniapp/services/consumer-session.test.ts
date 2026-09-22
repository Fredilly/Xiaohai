import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearConsumerSession,
  consumerToken,
  saveConsumerSession,
  storedConsumerId,
} from './consumer-session';
import { request } from './commerce';

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const values = new Map<string, string>();
  const app = { globalData: { consumerUserId: '' } };
  const requestMock = vi.fn();
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => values.get(key) ?? '',
    setStorageSync: (key: string, value: string) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    request: requestMock,
  });
  return { values, app, requestMock };
}

describe('Consumer session on weak networks and expiry', () => {
  it('restores an unexpired session and removes expired credentials before a request', () => {
    const { values, app } = storage();
    saveConsumerSession('token', new Date(Date.now() + 60_000).toISOString(), 'user');
    expect(storedConsumerId()).toBe('user');
    expect(app.globalData.consumerUserId).toBe('user');
    values.set('consumer_session_expires_at', new Date(Date.now() - 1000).toISOString());
    expect(consumerToken()).toBe('');
    expect(values.has('consumer_session_token')).toBe(false);
    expect(app.globalData.consumerUserId).toBe('');
  });

  it('clears a rejected session on 401 and preserves a network error for retry', async () => {
    const { values, requestMock } = storage();
    saveConsumerSession('token', new Date(Date.now() + 60_000).toISOString(), 'user');
    requestMock.mockImplementationOnce((input: { success: (value: unknown) => void }) => {
      input.success({ statusCode: 401, data: {} });
    });
    await expect(request('/api/v1/commerce/cart')).rejects.toMatchObject({ status: 401 });
    expect(values.has('consumer_session_token')).toBe(false);
    saveConsumerSession('token2', new Date(Date.now() + 60_000).toISOString(), 'user');
    requestMock.mockImplementationOnce((input: { fail: (value: unknown) => void }) => {
      input.fail({ errMsg: 'request:fail timeout' });
    });
    await expect(request('/api/v1/commerce/cart')).rejects.toBeTruthy();
    expect(values.get('consumer_session_token')).toBe('token2');
    clearConsumerSession();
  });
});
