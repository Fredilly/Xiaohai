import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from './config';

function useWeChatEnvironment(envVersion: 'develop' | 'trial' | 'release') {
  vi.stubGlobal('wx', {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Issue #76 Mini Program device API environment mapping', () => {
  it.each(['develop', 'trial'] as const)(
    '%s maps to the configured staging HTTPS origin instead of loopback',
    (envVersion) => {
      useWeChatEnvironment(envVersion);
      const url = getApiBaseUrl();
      expect(url).toBe('https://staging-api.pamboo.asia');
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/(?:127\.0\.0\.1|localhost)/);
    },
  );

  it('uses only the explicitly approved production HTTPS API in a release build', () => {
    useWeChatEnvironment('release');
    expect(getApiBaseUrl()).toBe('https://api.pamboo.asia');
    expect(getApiBaseUrl()).not.toBe('https://staging-api.pamboo.asia');
    expect(getApiBaseUrl()).toMatch(/^https:\/\//);
  });

  it('fails closed on unknown WeChat environment instead of selecting live production', () => {
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'unknown' } }),
    });
    expect(() => getApiBaseUrl()).toThrow('Unsupported WeChat environment version');
  });
});
