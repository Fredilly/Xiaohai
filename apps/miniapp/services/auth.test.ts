import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginWithWeChat } from './auth';
import { clearConsumerSession, saveConsumerSession, storedConsumerId } from './consumer-session';

type RequestOptions = { success: (response: unknown) => void };

function setupLogin() {
  const values = new Map<string, string>();
  const requests: RequestOptions[] = [];
  const app = { globalData: { consumerUserId: '' } };
  vi.stubGlobal('getApp', () => app);
  vi.stubGlobal('wx', {
    login: vi.fn(() => Promise.resolve({ code: 'one-time-code' })),
    request: vi.fn((options: RequestOptions) => requests.push(options)),
    getStorageSync: (key: string) => values.get(key) ?? '',
    setStorageSync: (key: string, value: string) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  });
  return { app, values, requests };
}

function loginResponse(
  id: string,
  token: string,
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
) {
  return { statusCode: 200, data: { consumer: { id }, session: { token, expiresAt } } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WeChat login account and session boundaries', () => {
  it('does not accept empty credentials or expired login responses', async () => {
    const { requests, values } = setupLogin();
    const invalid = [
      loginResponse('', 'token-A'),
      loginResponse('user-A', ''),
      loginResponse('user-A', 'token-A', 'invalid-date'),
      loginResponse('user-A', 'token-A', new Date(Date.now() - 60_000).toISOString()),
    ];
    for (const response of invalid) {
      const pending = loginWithWeChat();
      await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
      requests.shift()?.success(response);
      await expect(pending).rejects.toThrow('Consumer login failed');
      expect(values.has('consumer_session_token')).toBe(false);
    }
  });

  it('cannot restore a login after the user explicitly logged out', async () => {
    const { requests, values } = setupLogin();
    const pending = loginWithWeChat();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    clearConsumerSession();
    requests[0]?.success(loginResponse('old-user', 'old-token'));
    await expect(pending).rejects.toThrow('CONSUMER_SESSION_CHANGED');
    expect(values.has('consumer_session_token')).toBe(false);
  });

  it('refuses an older login response after a newer account has logged in', async () => {
    const { requests, app, values } = setupLogin();
    const oldLogin = loginWithWeChat();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const newLogin = loginWithWeChat();
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests[1]?.success(loginResponse('account-B', 'token-B'));
    await expect(newLogin).resolves.toMatchObject({ consumer: { id: 'account-B' } });
    requests[0]?.success(loginResponse('account-A', 'token-A'));
    await expect(oldLogin).rejects.toThrow('CONSUMER_SESSION_CHANGED');

    expect(values.get('consumer_session_token')).toBe('token-B');
    expect(storedConsumerId()).toBe('account-B');
    expect(app.globalData.consumerUserId).toBe('account-B');
  });

  it('preserves a newly authenticated account when an older login response arrives', async () => {
    const { requests, app, values } = setupLogin();
    const pending = loginWithWeChat();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    saveConsumerSession('new-token', new Date(Date.now() + 60_000).toISOString(), 'account-B');
    requests[0]?.success(loginResponse('account-A', 'old-token'));
    await expect(pending).rejects.toThrow('CONSUMER_SESSION_CHANGED');
    expect(values.get('consumer_session_token')).toBe('new-token');
    expect(app.globalData.consumerUserId).toBe('account-B');
  });
});
