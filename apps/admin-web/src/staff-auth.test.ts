import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaffMe } from './staff-auth';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HQ staff session checks', () => {
  it('rejects an expired session on HTTP 401', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(getStaffMe('obsolete-session')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/staff/me'),
      expect.objectContaining({ headers: { authorization: 'Bearer obsolete-session' } }),
    );
  });

  it('keeps a transient HTTP 503 distinct from an expired session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getStaffMe('still-valid-session')).rejects.toThrow('Staff context failed');
  });

  it('keeps a network failure distinct from an expired session', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network unavailable'));

    await expect(getStaffMe('still-valid-session')).rejects.toThrow('network unavailable');
  });
});
