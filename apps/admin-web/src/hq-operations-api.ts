import { fulfillmentStaffListResponseSchema } from '@xiaohai/contracts/fulfillment';
import {
  goodsReceiptSchema,
  goodsReceiptViewSchema,
  inventoryAlertsResponseSchema,
  inventoryListResponseSchema,
  inventoryTransactionsResponseSchema,
  purchaseOrderSchema,
  purchaseOrderViewSchema,
  stocktakeSchema,
  stocktakeViewSchema,
  stockTransferSchema,
  stockTransferViewSchema,
  supplierListResponseSchema,
  supplierSchema,
  type CreateGoodsReceiptRequest,
  type CreatePurchaseOrderRequest,
  type CreateStocktakeRequest,
  type CreateStockTransferRequest,
  type StocktakeCountRequest,
} from '@xiaohai/contracts/inventory';
import { rentalListResponseSchema } from '@xiaohai/contracts/rental';
import { staffStoresResponseSchema } from '@xiaohai/contracts/stores';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

async function request(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

export async function createHqSupplier(
  token: string,
  input: { code: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null },
) {
  return supplierSchema.parse(
    await request('/api/v1/staff/inventory/suppliers', token, 'POST', input),
  );
}

export async function createHqPurchaseOrder(token: string, input: CreatePurchaseOrderRequest) {
  return purchaseOrderViewSchema.parse(
    await request('/api/v1/staff/inventory/purchase-orders', token, 'POST', input),
  );
}

export async function actOnHqPurchaseOrder(
  token: string,
  id: string,
  action: 'SUBMIT' | 'CANCEL',
) {
  return purchaseOrderSchema.parse(
    await request(`/api/v1/staff/inventory/purchase-orders/${id}/actions`, token, 'POST', {
      action,
    }),
  );
}

export async function createHqGoodsReceipt(token: string, input: CreateGoodsReceiptRequest) {
  return goodsReceiptViewSchema.parse(
    await request('/api/v1/staff/inventory/goods-receipts', token, 'POST', input),
  );
}

export async function postHqGoodsReceipt(token: string, id: string) {
  return goodsReceiptSchema.parse(
    await request(`/api/v1/staff/inventory/goods-receipts/${id}/post`, token, 'POST'),
  );
}

export async function createHqStocktake(token: string, input: CreateStocktakeRequest) {
  return stocktakeViewSchema.parse(
    await request('/api/v1/staff/inventory/stocktakes', token, 'POST', input),
  );
}

export async function countHqStocktake(token: string, id: string, input: StocktakeCountRequest) {
  return stocktakeSchema.parse(
    await request(`/api/v1/staff/inventory/stocktakes/${id}/counts`, token, 'PUT', input),
  );
}

export async function actOnHqStocktake(
  token: string,
  id: string,
  action: 'START' | 'REVIEW' | 'POST' | 'CANCEL',
) {
  return stocktakeSchema.parse(
    await request(`/api/v1/staff/inventory/stocktakes/${id}/actions`, token, 'POST', { action }),
  );
}

export async function createHqStockTransfer(token: string, input: CreateStockTransferRequest) {
  return stockTransferViewSchema.parse(
    await request('/api/v1/staff/inventory/transfers', token, 'POST', input),
  );
}

export async function actOnHqStockTransfer(
  token: string,
  id: string,
  action: 'SUBMIT' | 'DISPATCH' | 'RECEIVE' | 'CANCEL',
) {
  return stockTransferSchema.parse(
    await request(`/api/v1/staff/inventory/transfers/${id}/actions`, token, 'POST', { action }),
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
