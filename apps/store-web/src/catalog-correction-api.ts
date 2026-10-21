import {
  catalogCorrectionRecordSchema,
  catalogCorrectionsResponseSchema,
  type CreateCatalogCorrection,
  type ReviewCatalogCorrection,
} from '@xiaohai/contracts/commerce';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base = typeof env.VITE_API_BASE_URL === 'string'
  ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

function endpoint(storeId: string) {
  return base + '/api/v1/staff/stores/' + encodeURIComponent(storeId) + '/catalog-corrections';
}

async function checked(response: Response) {
  if (response.status === 401) throw new Error('登录已过期，请重新登录');
  if (response.status === 403) throw new Error('没有当前门店的商品纠错权限');
  if (response.status === 409) throw new Error('存在冲突或重复待审核申请，请刷新后核对');
  if (!response.ok) throw new Error('商品纠错请求失败（HTTP ' + response.status + '）');
  return response.json() as Promise<unknown>;
}

export async function listCatalogCorrections(token: string, storeId: string) {
  const response = await fetch(endpoint(storeId), {
    headers: { Authorization: 'Bearer ' + token },
  });
  return catalogCorrectionsResponseSchema.parse(await checked(response));
}

export async function createCatalogCorrection(
  token: string, storeId: string, input: CreateCatalogCorrection,
) {
  const response = await fetch(endpoint(storeId), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return catalogCorrectionRecordSchema.parse(await checked(response));
}

export async function reviewCatalogCorrection(
  token: string, storeId: string, correctionId: string, input: ReviewCatalogCorrection,
) {
  const response = await fetch(endpoint(storeId) + '/' + encodeURIComponent(correctionId) + '/review', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return catalogCorrectionRecordSchema.parse(await checked(response));
}
