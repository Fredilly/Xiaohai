import {
  adminProductCreateInputSchema,
  adminProductUpdateInputSchema,
  adminProductListResponseSchema,
  adminProductSchema,
  storeCatalogEditRequestSchema,
  storeCatalogResponseSchema,
  type AdminProductCreateInput,
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

async function call(path: string, token: string, method = 'GET', body?: object): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

export const createAdminProduct = async (token: string, input: AdminProductCreateInput) =>
  adminProductSchema.parse(
    await call(
      '/api/v1/staff/catalog/products',
      token,
      'POST',
      adminProductCreateInputSchema.parse(input),
    ),
  );

export const updateAdminProduct = async (
  token: string,
  id: string,
  input: AdminProductUpdateInput,
) =>
  adminProductSchema.parse(
    await call(
      `/api/v1/staff/catalog/products/${id}`,
      token,
      'PUT',
      adminProductUpdateInputSchema.parse(input),
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
