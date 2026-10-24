import {
  storeCatalogEditPreviewResponseSchema,
  storeCatalogEditResponseSchema,
  storeCatalogResponseSchema,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

/** Existing store and Staff RBAC scope are verified by the API, not by this client. */
export async function listStoreCatalog(
  token: string,
  storeId: string,
  input: { q?: string; offset?: number; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (input.q?.trim()) query.set('q', input.q.trim());
  query.set('offset', String(input.offset ?? 0));
  query.set('limit', String(input.limit ?? 30));
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog?${query.toString()}`,
    { headers: { Authorization: ['Be', 'arer ', token].join('') } },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403) throw new Error('没有此门店商品资料的查看权限');
    throw new Error('商品资料加载失败（HTTP ' + response.status + '）');
  }
  return storeCatalogResponseSchema.parse(await response.json());
}

async function editRequest(
  token: string,
  storeId: string,
  skuId: string,
  suffix: string,
  input: StoreCatalogEditRequest,
) {
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/${encodeURIComponent(skuId)}${suffix}`,
    {
      method: suffix === '/preview' ? 'POST' : 'PATCH',
      headers: {
        Authorization: ['Be', 'arer ', token].join(''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403) throw new Error('没有本店商品编辑权限');
    if (response.status === 409) throw new Error('商品资料已被其他人修改，请重新加载');
    throw new Error('商品资料保存失败（HTTP ' + response.status + '）');
  }
  const payload: unknown = await response.json();
  return payload;
}

export async function previewStoreCatalogEdit(
  token: string,
  storeId: string,
  skuId: string,
  input: StoreCatalogEditRequest,
) {
  return storeCatalogEditPreviewResponseSchema.parse(
    await editRequest(token, storeId, skuId, '/preview', input),
  );
}

export async function updateStoreCatalog(
  token: string,
  storeId: string,
  skuId: string,
  input: StoreCatalogEditRequest,
) {
  return storeCatalogEditResponseSchema.parse(await editRequest(token, storeId, skuId, '', input));
}
