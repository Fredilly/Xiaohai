import { staffLoginResponseSchema, type StaffLoginResponse } from '@xiaohai/contracts';

const viteEnvironment = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const apiBaseUrl =
  typeof viteEnvironment.VITE_API_BASE_URL === 'string'
    ? viteEnvironment.VITE_API_BASE_URL
    : 'http://127.0.0.1:3000';

export async function loginStaff(
  loginIdentifier: string,
  password: string,
): Promise<StaffLoginResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/staff/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginIdentifier, password }),
  });
  if (!response.ok) throw new Error('Staff login failed');
  return staffLoginResponseSchema.parse(await response.json());
}
