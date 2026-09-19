import {
  hqOrderDetailSchema,
  hqOrderListResponseSchema,
  hqUserDetailSchema,
  hqUserListResponseSchema,
  type HqOrderListQuery,
  type HqUserListQuery,
} from '@xiaohai/contracts/hq';

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

function addQuery(path: string, values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.size ? `${path}?${query.toString()}` : path;
}

export async function loadHqOrders(token: string, input: Partial<HqOrderListQuery> = {}) {
  return hqOrderListResponseSchema.parse(
    await request(
      addQuery('/api/v1/staff/orders', {
        status: input.status,
        consumerUserId: input.consumerUserId,
        q: input.q,
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
        limit: input.limit,
      }),
      token,
    ),
  );
}

export async function loadHqOrder(token: string, id: string) {
  return hqOrderDetailSchema.parse(await request(`/api/v1/staff/orders/${id}`, token));
}

export async function loadHqUsers(token: string, input: Partial<HqUserListQuery> = {}) {
  return hqUserListResponseSchema.parse(
    await request(
      addQuery('/api/v1/staff/users', {
        id: input.id,
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
        limit: input.limit,
      }),
      token,
    ),
  );
}

export async function loadHqUser(token: string, id: string) {
  return hqUserDetailSchema.parse(await request(`/api/v1/staff/users/${id}`, token));
}
