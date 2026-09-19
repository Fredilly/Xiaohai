import { fulfillmentStaffListResponseSchema } from '@xiaohai/contracts/fulfillment';
import {
  inventoryAlertsResponseSchema,
  inventoryListResponseSchema,
  inventoryTransactionsResponseSchema,
  supplierListResponseSchema,
} from '@xiaohai/contracts/inventory';
import { rentalListResponseSchema } from '@xiaohai/contracts/rental';
import { staffStoresResponseSchema } from '@xiaohai/contracts/stores';

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

function withStore(path: string, storeId?: string) {
  if (!storeId) return path;
  return `${path}?${new URLSearchParams({ storeId }).toString()}`;
}

export async function loadHqStores(token: string) {
  return staffStoresResponseSchema.parse(await request('/api/v1/staff/stores', token));
}

export async function loadHqInventory(token: string, storeId?: string) {
  return inventoryListResponseSchema.parse(
    await request(withStore('/api/v1/staff/inventory', storeId), token),
  );
}

export async function loadHqInventoryAlerts(token: string, storeId: string, threshold = 5) {
  const query = new URLSearchParams({ threshold: String(threshold) });
  return inventoryAlertsResponseSchema.parse(
    await request(`/api/v1/staff/inventory/stores/${storeId}/alerts?${query.toString()}`, token),
  );
}

export async function loadHqInventoryTransactions(token: string, storeId: string) {
  return inventoryTransactionsResponseSchema.parse(
    await request(`/api/v1/staff/inventory/stores/${storeId}/transactions`, token),
  );
}

export async function loadHqSuppliers(token: string) {
  return supplierListResponseSchema.parse(
    await request('/api/v1/staff/inventory/suppliers', token),
  );
}

export async function loadHqRentals(token: string, storeId?: string) {
  return rentalListResponseSchema.parse(
    await request(withStore('/api/v1/staff/rentals', storeId), token),
  );
}

export async function loadHqFulfillment(token: string, storeId?: string) {
  return fulfillmentStaffListResponseSchema.parse(
    await request(withStore('/api/v1/staff/fulfillment', storeId), token),
  );
}
