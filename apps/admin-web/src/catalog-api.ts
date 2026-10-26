import {
  adminProductInputSchema,
  adminProductUpdateInputSchema,
  adminProductListResponseSchema,
  adminProductSchema,
  storeCatalogEditRequestSchema,
  storeCatalogResponseSchema,
  type AdminProductInput,
  type AdminProductUpdateInput,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';

export class CatalogApiError extends Error {
  constructor(readonly status: number) {
    super(`Catalog API ${status}`);
  }
}

async function call(
  path: string,
  token: string,
  method = 'GET',
  body?: object,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new CatalogApiError(response.status);

  const payload: unknown = await response.json();
  return payload;
}

export const listAdminProducts = async (token: string, q = '') =>
  adminProductListResponseSchema.parse(
    await call(`/api/v1/staff/catalog/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, token),
  );

export const createAdminProduct = async (token: string, input: AdminProductInput) =>
  adminProductSchema.parse(
    await call(
      '/api/v1/staff/catalog/products',
      token,
      'POST',
      adminProductInputSchema.parse(input),
    ),
  );

export const previewAdminProductUpdate = async (
  token: string,
  id: string,
  input: AdminProductUpdateInput,
) =>
  (await call(
    `/api/v1/staff/catalog/products/${encodeURIComponent(id)}/preview`,
    token,
    'POST',
    adminProductUpdateInputSchema.parse(input),
  )) as {
    previewToken: string;
    impact: { affectedStoreCount: number; affectedStoreIds: string[] };
  };

export const updateAdminProduct = async (
  token: string,
  id: string,
  input: AdminProductUpdateInput,
  previewToken: string,
) =>
  adminProductSchema.parse(
    await call(
      `/api/v1/staff/catalog/products/${encodeURIComponent(id)}`,
      token,
      'PUT',
      adminProductUpdateInputSchema.parse(input),
      { 'X-Catalog-Preview-Token': previewToken },
    ),
  );

export async function listHqStoreCatalog(token: string, storeId: string) {
  const query = new URLSearchParams({ offset: '0', limit: '30' });
  return storeCatalogResponseSchema.parse(
    await call(`/api/v1/staff/catalog/stores/${encodeURIComponent(storeId)}/items?${query}`, token),
  );
}

export async function previewHqStoreCatalogEdit(
  token: string,
  storeId: string,
  skuId: string,
  input: StoreCatalogEditRequest,
) {
  return (await call(
    `/api/v1/staff/catalog/stores/${encodeURIComponent(storeId)}/items/${encodeURIComponent(skuId)}/preview`,
    token,
    'POST',
    storeCatalogEditRequestSchema.parse(input),
  )) as {
    impact: { affectedStoreCount: number; affectedStoreIds: string[]; sharedFields: string[] };
  };
}

export async function updateHqStoreCatalog(
  token: string,
  storeId: string,
  skuId: string,
  input: StoreCatalogEditRequest,
) {
  return call(
    `/api/v1/staff/catalog/stores/${encodeURIComponent(storeId)}/items/${encodeURIComponent(skuId)}`,
    token,
    'PATCH',
    storeCatalogEditRequestSchema.parse(input),
  );
}
