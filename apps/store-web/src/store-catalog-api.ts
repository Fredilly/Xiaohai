import {
  adminProductCreateInputSchema,
  adminProductSchema,
  type AdminProductCreateInput,
  merchantProductImageUploadSchema,
  merchantProductImageUploadResultSchema,
  merchantProductGalleryResponseSchema,
  merchantProductGalleryUpdateSchema,
  type MerchantProductImageUpload,
  type MerchantProductGalleryUpdate,
  storeCatalogEditPreviewResponseSchema,
  storeCatalogEditResponseSchema,
  storeCatalogResponseSchema,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base = typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : '';

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
  previewToken?: string,
) {
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/${encodeURIComponent(skuId)}${suffix}`,
    {
      method: suffix === '/preview' ? 'POST' : 'PATCH',
      headers: {
        Authorization: ['Be', 'arer ', token].join(''),
        'Content-Type': 'application/json',
        ...(previewToken ? { 'x-catalog-preview-token': previewToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403) throw new Error('没有编辑权限或商品变更影响其他门店');
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
  previewToken?: string,
) {
  return storeCatalogEditResponseSchema.parse(
    await editRequest(token, storeId, skuId, '', input, previewToken),
  );
}

/** New Store merchandise stays DRAFT and starts with zero physical stock. */
export class StoreDraftRejectedError extends Error {}

export async function createStoreDraftProduct(
  token: string,
  storeId: string,
  input: AdminProductCreateInput,
  idempotencyKey: string,
) {
  const payload = adminProductCreateInputSchema.parse(input);
  if (payload.status !== 'DRAFT' || payload.sku.availableForSale) {
    throw new Error('只能创建未上架、不可售的商品草稿');
  }
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/products`,
    {
      method: 'POST',
      headers: {
        Authorization: ['Be', 'arer ', token].join(''),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    // These responses definitively reject this attempt. A timeout, 5xx or
    // malformed success body might follow a committed create and must keep its key.
    const rejected = [400, 401, 403, 409, 422].includes(response.status);
    const failure =
      response.status === 401
        ? '登录已过期，请重新登录'
        : response.status === 403
          ? '没有本店商品创建权限'
          : response.status === 409
            ? '商品或条码已存在，或当前请求与上次录入不一致'
            : '创建商品草稿失败（HTTP ' + response.status + '）';
    if (rejected) throw new StoreDraftRejectedError(failure);
    throw new Error(failure);
  }
  return adminProductSchema.parse(await response.json());
}

export async function uploadStoreDraftProductImage(
  token: string,
  storeId: string,
  productId: string,
  input: MerchantProductImageUpload,
) {
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/products/${encodeURIComponent(productId)}/images`,
    {
      method: 'POST',
      headers: {
        Authorization: ['Be', 'arer ', token].join(''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(merchantProductImageUploadSchema.parse(input)),
    },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403) throw new Error('没有权限，或该商品已关联其他门店');
    if (response.status === 409) throw new Error('商品版本已变更或图片数已满，请刷新商品列表');
    if (response.status === 503) throw new Error('商品图片存储尚未配置，暂时无法上传');
    throw new Error('图片上传失败（HTTP ' + response.status + '）');
  }
  return merchantProductImageUploadResultSchema.parse(await response.json());
}

/** One versioned image gallery belongs to the shared product, not a store copy. */
export async function getStoreProductGallery(token: string, storeId: string, productId: string) {
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/products/${encodeURIComponent(productId)}/images`,
    { headers: { Authorization: ['Be', 'arer ', token].join('') } },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403 || response.status === 404)
      throw new Error('没有权限读取本店商品图库');
    throw new Error('读取商品图库失败（HTTP ' + response.status + '）');
  }
  const gallery = merchantProductGalleryResponseSchema.parse(await response.json());
  if (gallery.productId !== productId) throw new Error('商品图库身份不一致，请重新加载');
  return gallery;
}

export async function updateStoreProductGallery(
  token: string,
  storeId: string,
  productId: string,
  input: MerchantProductGalleryUpdate,
) {
  const response = await fetch(
    `${base}/api/v1/staff/stores/${encodeURIComponent(storeId)}/catalog/products/${encodeURIComponent(productId)}/images`,
    {
      method: 'PATCH',
      headers: {
        Authorization: ['Be', 'arer ', token].join(''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(merchantProductGalleryUpdateSchema.parse(input)),
    },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录');
    if (response.status === 403) throw new Error('该商品关联其他门店，不能在本店单独调整图库');
    if (response.status === 409) throw new Error('商品已上架或版本冲突，请刷新后再编辑');
    throw new Error('保存商品图库失败（HTTP ' + response.status + '）');
  }
  const gallery = merchantProductGalleryResponseSchema.parse(await response.json());
  if (gallery.productId !== productId) throw new Error('保存结果所属商品不一致，请重新加载');
  return gallery;
}
