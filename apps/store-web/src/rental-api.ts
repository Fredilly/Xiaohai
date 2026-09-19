import { rentalListResponseSchema } from '@xiaohai/contracts/rental';
const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';
async function request(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return response.json() as Promise<unknown>;
}
export async function loadRentals(token: string, storeId?: string) {
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  const query = params.size ? `?${params.toString()}` : '';
  return rentalListResponseSchema.parse(await request(`/api/v1/staff/rentals${query}`, token));
}
export async function rentalAction(
  token: string,
  id: string,
  action: 'borrow' | 'return',
  pickupCode?: string,
) {
  return request(`/api/v1/staff/rentals/${id}/${action}`, token, 'POST', {
    idempotencyKey: crypto.randomUUID(),
    ...(action === 'borrow' ? { pickupCode } : {}),
  });
}
