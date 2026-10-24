import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from './config';

function useWeChatEnvironment(envVersion: 'develop' | 'trial' | 'release') {
  vi.stubGlobal('wx', {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
  });
}

describe('Mini Program API environment selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps local loopback only for the developer environment', () => {
    useWeChatEnvironment('develop');
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3000');
  });

  it('uses the verified HTTPS staging API for trial builds', () => {
    useWeChatEnvironment('trial');
    expect(getApiBaseUrl()).toBe('https://staging-api.pamboo.asia');
  });

  it('does not silently use staging for release builds', () => {
    useWeChatEnvironment('release');
    expect(getApiBaseUrl()).toBe('https://api.example.invalid');
  });
});
