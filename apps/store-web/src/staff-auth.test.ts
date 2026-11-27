import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaffMe } from './staff-auth';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Store staff session checks', () => {
  it('treats a 401 as a revoked or expired session', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(getStaffMe('obsolete-session')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/staff/me'),
      expect.objectContaining({ headers: { authorization: 'Bearer obsolete-session' } }),
    );
  });

  it('preserves the session for retry when the API is temporarily unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getStaffMe('still-valid-session')).rejects.toThrow('Staff context failed');
  });

  it('preserves the session for retry on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network unavailable'));

    await expect(getStaffMe('still-valid-session')).rejects.toThrow('network unavailable');
  });
});
