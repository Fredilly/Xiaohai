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
    '%s resolves to a reachable HTTPS staging hostname rather than device loopback',
    (envVersion) => {
      useWeChatEnvironment(envVersion);
      const url = getApiBaseUrl();
      expect(url).toBe('https://staging-api.pamboo.asia');
      expect(new URL(url).protocol).toBe('https:');
      expect(new URL(url).hostname).not.toBe('127.0.0.1');
      expect(new URL(url).hostname).not.toBe('localhost');
    },
  );

  it('keeps release pointed at an intentionally non-functional placeholder', () => {
    useWeChatEnvironment('release');
    expect(getApiBaseUrl()).toBe('https://api.example.invalid');
  });

  it('fails closed on unknown WeChat environment instead of selecting live production', () => {
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'unknown' } }),
    });
    expect(() => getApiBaseUrl()).toThrow('Unsupported WeChat environment version');
  });
});
