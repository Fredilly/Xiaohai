import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStaffAccount,
  loadStaffAccounts,
  loadStaffPermissions,
  loadStaffRoles,
  replaceStaffDataScopes,
  replaceStaffRoles,
  resetStaffPassword,
  setStaffEnabled,
} from './staff-admin-api';

afterEach(() => vi.unstubAllGlobals());

const staffId = '11111111-1111-4111-8111-111111111111';
const roleId = '22222222-2222-4222-8222-222222222222';
const storeId = '33333333-3333-4333-8333-333333333333';

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
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer staff-token');
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

  it('sends server-controlled Staff lifecycle and RBAC mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(account) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ ...account, enabled: false }) })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...account,
          roles: [{ id: roleId, key: 'operator', displayName: 'Operator' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...account,
          dataScopes: [{ type: 'STORE', id: storeId }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await createStaffAccount('staff-token', {
      loginIdentifier: 'new@example.com',
      password: 'a-secure-passphrase',
      enabled: true,
    });
    await setStaffEnabled('staff-token', staffId, false);
    await resetStaffPassword('staff-token', staffId, 'another-secure-passphrase');
    await replaceStaffRoles('staff-token', staffId, { roleIds: [roleId] });
    await replaceStaffDataScopes('staff-token', staffId, {
      dataScopes: [{ type: 'STORE', id: storeId }],
    });

    const expected = [
      ['POST', '/api/v1/staff/admin/accounts'],
      ['PATCH', `/api/v1/staff/admin/accounts/${staffId}/enabled`],
      ['POST', `/api/v1/staff/admin/accounts/${staffId}/reset-password`],
      ['PUT', `/api/v1/staff/admin/accounts/${staffId}/roles`],
      ['PUT', `/api/v1/staff/admin/accounts/${staffId}/data-scopes`],
    ] as const;

    expected.forEach(([method, path], index) => {
      const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
      expect(url).toContain(path);
      expect(init.method).toBe(method);
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer staff-token');
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    });
  });
});
