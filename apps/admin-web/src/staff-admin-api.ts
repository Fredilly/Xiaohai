import {
  staffAdminAccountSchema,
  staffAdminListResponseSchema,
  staffAdminPermissionsResponseSchema,
  staffAdminRolesResponseSchema,
  type StaffAdminListQuery,
} from '@xiaohai/contracts/staff-admin';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

async function request(path: string, token: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return (await response.json()) as unknown;
}

export async function loadStaffAccounts(
  token: string,
  input: Partial<StaffAdminListQuery> = {},
) {
  const query = new URLSearchParams();
  if (input.q) query.set('q', input.q);
  if (input.enabled !== undefined) query.set('enabled', String(input.enabled));
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  const suffix = query.size ? `?${query.toString()}` : '';
  return staffAdminListResponseSchema.parse(
    await request(`/api/v1/staff/admin/accounts${suffix}`, token),
  );
}

export async function loadStaffAccount(token: string, id: string) {
  return staffAdminAccountSchema.parse(await request(`/api/v1/staff/admin/accounts/${id}`, token));
}

export async function loadStaffRoles(token: string) {
  return staffAdminRolesResponseSchema.parse(await request('/api/v1/staff/admin/roles', token));
}

export async function loadStaffPermissions(token: string) {
  return staffAdminPermissionsResponseSchema.parse(
    await request('/api/v1/staff/admin/permissions', token),
  );
}
