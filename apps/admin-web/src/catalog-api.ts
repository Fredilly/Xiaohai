import {
  adminProductCreateInputSchema,
  adminProductUpdateInputSchema,
  adminProductListResponseSchema,
  adminProductSchema,
  bookLookupResponseSchema,
  storeCatalogEditRequestSchema,
  storeCatalogResponseSchema,
  type AdminProductCreateInput,
  type AdminProductUpdateInput,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';

export class CatalogApiError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Catalog API ${status}`);
  }
}

async function call(path: string, token: string, method = 'GET', body?: object): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = (
      typeof response.json === 'function' ? await response.json().catch(() => null) : null
    ) as {
      error?: { message?: unknown };
    } | null;
    throw new CatalogApiError(
      response.status,
      typeof payload?.error?.message === 'string' ? payload.error.message : undefined,
    );
  }

  const payload: unknown = await response.json();
  return payload;
}

export const listAdminProducts = async (token: string, q = '', offset = 0, limit = 30) =>
  adminProductListResponseSchema.parse(
    await call(
      `/api/v1/staff/catalog/products?${new URLSearchParams({
        ...(q ? { q } : {}),
        offset: String(offset),
        limit: String(limit),
      })}`,
      token,
    ),
  );

export const getAdminProduct = async (token: string, id: string) =>
  adminProductSchema.parse(await call(`/api/v1/staff/catalog/products/${id}`, token));

export const createAdminProduct = async (token: string, input: AdminProductCreateInput) =>
  adminProductSchema.parse(
    await call(
      '/api/v1/staff/catalog/products',
      token,
      'POST',
      adminProductCreateInputSchema.parse(input),
    ),
  );

export const lookupBook = async (token: string, code: string) =>
  bookLookupResponseSchema.parse(
    await call(`/api/v1/staff/catalog/books/lookup?${new URLSearchParams({ code })}`, token),
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
