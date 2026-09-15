import { staffLoginResponseSchema, staffMeResponseSchema, type StaffLoginResponse, type StaffMeResponse } from '@xiaohai/contracts';

const viteEnvironment = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const apiBaseUrl = typeof viteEnvironment.VITE_API_BASE_URL === 'string' ? viteEnvironment.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

export async function loginStaff(loginIdentifier: string, password: string): Promise<StaffLoginResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/staff/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginIdentifier, password }) });
  if (!response.ok) throw new Error('Staff login failed');
  return staffLoginResponseSchema.parse(await response.json());
}

export async function getStaffMe(token: string): Promise<StaffMeResponse | null> {
  const response = await fetch(`${apiBaseUrl}/api/v1/staff/me`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Staff context failed');
  return staffMeResponseSchema.parse(await response.json());
}
