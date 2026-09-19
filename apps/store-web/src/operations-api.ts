import {
  goodsReceiptSchema,
  goodsReceiptViewSchema,
  inventoryAlertsResponseSchema,
  inventoryTransactionsResponseSchema,
  purchaseOrderSchema,
  purchaseOrderViewSchema,
  stocktakeSchema,
  stocktakeViewSchema,
  stockTransferSchema,
  stockTransferViewSchema,
  supplierListResponseSchema,
  type CreateGoodsReceiptRequest,
  type CreatePurchaseOrderRequest,
  type CreateStocktakeRequest,
  type CreateStockTransferRequest,
  type StocktakeCountRequest,
} from '@xiaohai/contracts/inventory';

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
  return (await response.json()) as unknown;
}

export async function loadInventoryAlerts(token: string, storeId: string, threshold = 5) {
  const query = new URLSearchParams({ threshold: String(threshold) });
  return inventoryAlertsResponseSchema.parse(
    await request(`/api/v1/staff/inventory/stores/${storeId}/alerts?${query}`, token),
  );
}

export async function loadInventoryTransactions(token: string, storeId: string) {
  return inventoryTransactionsResponseSchema.parse(
    await request(`/api/v1/staff/inventory/stores/${storeId}/transactions`, token),
  );
}

export async function loadSuppliers(token: string) {
  return supplierListResponseSchema.parse(
    await request('/api/v1/staff/inventory/suppliers', token),
  );
}

export async function createPurchaseOrder(
  token: string,
  input: CreatePurchaseOrderRequest,
) {
  return purchaseOrderViewSchema.parse(
    await request('/api/v1/staff/inventory/purchase-orders', token, 'POST', input),
  );
}

export async function actOnPurchaseOrder(
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

export async function createGoodsReceipt(
  token: string,
  input: CreateGoodsReceiptRequest,
) {
  return goodsReceiptViewSchema.parse(
    await request('/api/v1/staff/inventory/goods-receipts', token, 'POST', input),
  );
}

export async function postGoodsReceipt(token: string, id: string) {
  return goodsReceiptSchema.parse(
    await request(`/api/v1/staff/inventory/goods-receipts/${id}/post`, token, 'POST'),
  );
}

export async function createStocktake(token: string, input: CreateStocktakeRequest) {
  return stocktakeViewSchema.parse(
    await request('/api/v1/staff/inventory/stocktakes', token, 'POST', input),
  );
}

export async function countStocktake(token: string, id: string, input: StocktakeCountRequest) {
  return stocktakeSchema.parse(
    await request(`/api/v1/staff/inventory/stocktakes/${id}/counts`, token, 'PUT', input),
  );
}

export async function actOnStocktake(
  token: string,
  id: string,
  action: 'START' | 'REVIEW' | 'POST' | 'CANCEL',
) {
  return stocktakeSchema.parse(
    await request(`/api/v1/staff/inventory/stocktakes/${id}/actions`, token, 'POST', { action }),
  );
}

export async function createStockTransfer(
  token: string,
  input: CreateStockTransferRequest,
) {
  return stockTransferViewSchema.parse(
    await request('/api/v1/staff/inventory/transfers', token, 'POST', input),
  );
}

export async function actOnStockTransfer(
  token: string,
  id: string,
  action: 'SUBMIT' | 'DISPATCH' | 'RECEIVE' | 'CANCEL',
) {
  return stockTransferSchema.parse(
    await request(`/api/v1/staff/inventory/transfers/${id}/actions`, token, 'POST', { action }),
  );
}
