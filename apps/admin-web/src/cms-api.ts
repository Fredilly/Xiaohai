import {
  adminHomeResponseSchema,
  cmsSectionSchema,
  type AdminHomeResponse,
  type CmsSection,
  type CmsSectionInput,
  type ReorderCmsSectionsRequest,
  type UpdateCmsSectionRequest,
} from '@xiaohai/contracts';

const viteEnvironment = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const apiBaseUrl =
  typeof viteEnvironment.VITE_API_BASE_URL === 'string'
    ? viteEnvironment.VITE_API_BASE_URL
    : 'http://127.0.0.1:3000';

export class CmsApiError extends Error {
  constructor(readonly status: number) {
    super(`CMS API failed with ${status}`);
  }
}

export async function getCmsHome(token: string): Promise<AdminHomeResponse> {
  return adminHomeResponseSchema.parse(await request('/api/v1/staff/cms/home', token));
}

export async function createCmsSection(token: string, input: CmsSectionInput): Promise<CmsSection> {
  return cmsSectionSchema.parse(
    await request('/api/v1/staff/cms/home/sections', token, 'POST', input),
  );
}

export async function updateCmsSection(
  token: string,
  id: string,
  input: UpdateCmsSectionRequest,
): Promise<CmsSection> {
  return cmsSectionSchema.parse(
    await request(`/api/v1/staff/cms/home/sections/${id}`, token, 'PATCH', input),
  );
}

export async function reorderCmsSections(
  token: string,
  input: ReorderCmsSectionsRequest,
): Promise<AdminHomeResponse> {
  return adminHomeResponseSchema.parse(
    await request('/api/v1/staff/cms/home/sections/reorder', token, 'PUT', input),
  );
}

export async function updateCmsPublication(
  token: string,
  publicationState: 'DRAFT' | 'PUBLISHED',
  version: number,
): Promise<AdminHomeResponse> {
  return adminHomeResponseSchema.parse(
    await request('/api/v1/staff/cms/home/publication', token, 'PATCH', {
      publicationState,
      version,
    }),
  );
}

async function request(path: string, token: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new CmsApiError(response.status);
  return response.json();
}
