import { healthResponseSchema, type HealthResponse } from '@xiaohai/contracts';
import {
  auditLogListResponseSchema,
  type AuditLogListQuery,
  type AuditLogListResponse,
} from '@xiaohai/contracts/audit';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

async function parseJson(response: Response) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return (await response.json()) as unknown;
}

export async function loadSystemHealth(): Promise<HealthResponse> {
  const response = await fetch(`${base}/health`);
  return healthResponseSchema.parse(await parseJson(response));
}

export async function loadAuditLogs(
  token: string,
  input: Partial<AuditLogListQuery> = {},
): Promise<AuditLogListResponse> {
  const query = new URLSearchParams();
  if (input.actorStaffAccountId) query.set('actorStaffAccountId', input.actorStaffAccountId);
  if (input.actionKey) query.set('actionKey', input.actionKey);
  if (input.resourceType) query.set('resourceType', input.resourceType);
  if (input.resourceId) query.set('resourceId', input.resourceId);
  if (input.requestId) query.set('requestId', input.requestId);
  if (input.createdFrom) query.set('createdFrom', input.createdFrom);
  if (input.createdTo) query.set('createdTo', input.createdTo);
  if (input.limit !== undefined) query.set('limit', String(input.limit));

  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await fetch(`${base}/api/v1/staff/audit-logs${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return auditLogListResponseSchema.parse(await parseJson(response));
}
