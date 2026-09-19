import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaffAccounts, loadStaffPermissions, loadStaffRoles } from './staff-admin-api';

afterEach(() => vi.unstubAllGlobals());

const staffId = '11111111-1111-4111-8111-111111111111';

const account = {
  id: staffId,
  loginIdentifier: 'hq@example.com',
  enabled: true,
  roles: [],
  dataScopes: [{ type: 'GLOBAL', id: null }],
  lastLoginAt: null,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
};

describe('M20 Staff admin adapter', () => {
  it('sends Staff bearer token and bounded list filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [account] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadStaffAccounts('staff-token', {
      q: 'hq',
      enabled: true,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/admin/accounts?');
    expect(url).toContain('q=hq');
    expect(url).toContain('enabled=true');
    expect(url).toContain('limit=20');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
  });

  it('loads roles and permissions from dedicated HQ endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    expect((await loadStaffRoles('staff-token')).items).toEqual([]);
    expect((await loadStaffPermissions('staff-token')).items).toEqual([]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/staff/admin/roles');
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain('/api/v1/staff/admin/permissions');
  });
});
