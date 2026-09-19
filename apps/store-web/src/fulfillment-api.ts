import {
  deliveryZoneListResponseSchema,
  deliveryZoneSchema,
  fulfillmentStaffListResponseSchema,
  fulfillmentViewSchema,
  type DeliveryZoneInput,
} from '@xiaohai/contracts/fulfillment';

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

function withStore(path: string, storeId?: string) {
  if (!storeId) return path;
  const params = new URLSearchParams({ storeId });
  return `${path}?${params.toString()}`;
}

export async function loadFulfillment(token: string, storeId?: string) {
  return fulfillmentStaffListResponseSchema.parse(
    await request(withStore('/api/v1/staff/fulfillment', storeId), token),
  );
}

export async function loadDeliveryZones(token: string, storeId?: string) {
  return deliveryZoneListResponseSchema.parse(
    await request(withStore('/api/v1/staff/delivery-zones', storeId), token),
  );
}

export async function createDeliveryZone(
  token: string,
  input: Omit<DeliveryZoneInput, 'providerKey'>,
) {
  return deliveryZoneSchema.parse(
    await request('/api/v1/staff/delivery-zones', token, 'POST', input),
  );
}

export async function markPickupReady(token: string, orderId: string) {
  return fulfillmentViewSchema.parse(
    await request(`/api/v1/staff/fulfillment/orders/${orderId}/pickup/ready`, token, 'POST', {
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}

export async function verifyPickup(token: string, orderId: string, pickupCode: string) {
  return fulfillmentViewSchema.parse(
    await request(`/api/v1/staff/fulfillment/orders/${orderId}/pickup/verify`, token, 'POST', {
      idempotencyKey: crypto.randomUUID(),
      pickupCode,
    }),
  );
}

export async function dispatchDelivery(token: string, orderId: string) {
  return fulfillmentViewSchema.parse(
    await request(`/api/v1/staff/fulfillment/orders/${orderId}/delivery/dispatch`, token, 'POST', {
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}

export async function completeDelivery(token: string, orderId: string) {
  return fulfillmentViewSchema.parse(
    await request(`/api/v1/staff/fulfillment/orders/${orderId}/delivery/complete`, token, 'POST', {
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}
