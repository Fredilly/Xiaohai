import {
  staffAdminAccountSchema,
  staffAdminListResponseSchema,
  staffAdminOkSchema,
  staffAdminPermissionsResponseSchema,
  staffAdminRolesResponseSchema,
  type StaffAdminCreateAccount,
  type StaffAdminListQuery,
  type StaffAdminReplaceDataScopes,
  type StaffAdminReplaceRoles,
} from '@xiaohai/contracts/staff-admin';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

async function request(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${base}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return (await response.json()) as unknown;
}

export async function loadStaffAccounts(token: string, input: Partial<StaffAdminListQuery> = {}) {
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

export async function createStaffAccount(token: string, input: StaffAdminCreateAccount) {
  return staffAdminAccountSchema.parse(
    await request('/api/v1/staff/admin/accounts', token, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function setStaffEnabled(token: string, id: string, enabled: boolean) {
  return staffAdminAccountSchema.parse(
    await request(`/api/v1/staff/admin/accounts/${id}/enabled`, token, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  );
}

export async function resetStaffPassword(token: string, id: string, password: string) {
  return staffAdminOkSchema.parse(
    await request(`/api/v1/staff/admin/accounts/${id}/reset-password`, token, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  );
}

export async function replaceStaffRoles(token: string, id: string, input: StaffAdminReplaceRoles) {
  return staffAdminAccountSchema.parse(
    await request(`/api/v1/staff/admin/accounts/${id}/roles`, token, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}

export async function replaceStaffDataScopes(
  token: string,
  id: string,
  input: StaffAdminReplaceDataScopes,
) {
  return staffAdminAccountSchema.parse(
    await request(`/api/v1/staff/admin/accounts/${id}/data-scopes`, token, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}

export async function loadStaffRoles(token: string) {
  return staffAdminRolesResponseSchema.parse(await request('/api/v1/staff/admin/roles', token));
}

export async function loadStaffPermissions(token: string) {
  return staffAdminPermissionsResponseSchema.parse(
    await request('/api/v1/staff/admin/permissions', token),
  );
}
