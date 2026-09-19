import {
  inventoryListResponseSchema,
  type InventoryMutationRequest,
} from '@xiaohai/contracts/inventory';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

export async function loadInventory(token: string, storeId?: string) {
  const params = new URLSearchParams();
  if (storeId) params.set('storeId', storeId);
  const query = params.size ? `?${params.toString()}` : '';
  return inventoryListResponseSchema.parse(await request(`/api/v1/staff/inventory${query}`, token));
}
export async function issueInventory(token: string, input: InventoryMutationRequest) {
  return await request('/api/v1/staff/inventory/issues', token, 'POST', input);
}
export async function adjustInventory(
  token: string,
  input: Omit<InventoryMutationRequest, 'quantity'> & { quantityDelta: number },
) {
  return await request('/api/v1/staff/inventory/adjustments', token, 'POST', input);
}
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
  return (await response.json()) as unknown;
}
