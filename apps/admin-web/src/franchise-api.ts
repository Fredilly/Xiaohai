import {
  franchiseApplicationListResponseSchema,
  franchiseApplicationViewSchema,
  type AssignFranchiseApplicationRequest,
  type CreateFranchiseFollowupRequest,
  type FranchiseApplicationListQuery,
  type FranchiseApplicationStatus,
  type FranchiseApplicationView,
  type ReviewFranchiseApplicationRequest,
  type UpdateFranchiseApplicationStatusRequest,
} from '@xiaohai/contracts/franchise';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';

async function call(
  token: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: object,
): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new Error(data?.error?.code ?? `HTTP_${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export async function listFranchiseApplications(
  token: string,
  query: Partial<FranchiseApplicationListQuery> = {},
) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.assignedStaffAccountId)
    params.set('assignedStaffAccountId', query.assignedStaffAccountId);
  if (query.country) params.set('country', query.country);
  if (query.region) params.set('region', query.region);
  if (query.city) params.set('city', query.city);
  if (query.query) params.set('query', query.query);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.size ? `?${params.toString()}` : '';
  return franchiseApplicationListResponseSchema.parse(
    await call(token, `/api/v1/staff/franchise/applications${suffix}`),
  );
}

export async function getFranchiseApplication(
  token: string,
  id: string,
): Promise<FranchiseApplicationView> {
  return franchiseApplicationViewSchema.parse(
    await call(token, `/api/v1/staff/franchise/applications/${encodeURIComponent(id)}`),
  );
}

export async function assignFranchiseApplication(
  token: string,
  id: string,
  input: AssignFranchiseApplicationRequest,
) {
  return franchiseApplicationViewSchema.parse(
    await call(
      token,
      `/api/v1/staff/franchise/applications/${encodeURIComponent(id)}/assign`,
      'POST',
      input,
    ),
  );
}

export async function addFranchiseFollowup(
  token: string,
  id: string,
  input: CreateFranchiseFollowupRequest,
) {
  return franchiseApplicationViewSchema.parse(
    await call(
      token,
      `/api/v1/staff/franchise/applications/${encodeURIComponent(id)}/followups`,
      'POST',
      input,
    ),
  );
}

export async function reviewFranchiseApplication(
  token: string,
  id: string,
  input: ReviewFranchiseApplicationRequest,
) {
  return franchiseApplicationViewSchema.parse(
    await call(
      token,
      `/api/v1/staff/franchise/applications/${encodeURIComponent(id)}/review`,
      'POST',
      input,
    ),
  );
}

export async function updateFranchiseApplicationStatus(
  token: string,
  id: string,
  status: Extract<FranchiseApplicationStatus, 'SIGNED' | 'PREPARING' | 'OPENED' | 'CLOSED'>,
  version: number,
) {
  const input: UpdateFranchiseApplicationStatusRequest = { status, version };
  return franchiseApplicationViewSchema.parse(
    await call(
      token,
      `/api/v1/staff/franchise/applications/${encodeURIComponent(id)}/status`,
      'POST',
      input,
    ),
  );
}
