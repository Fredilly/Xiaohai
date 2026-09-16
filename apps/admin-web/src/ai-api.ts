import {
  aiJobListSchema,
  aiJobSchema,
  createAiJobRequestSchema,
  type AiJob,
} from '@xiaohai/contracts/ai';
const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';
export class AiApiError extends Error {
  constructor(readonly status: number) {
    super(`AI API ${status}`);
  }
}
async function call(path: string, token: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new AiApiError(response.status);
  return response.json() as Promise<unknown>;
}
export const listAiJobs = async (token: string) =>
  aiJobListSchema.parse(await call('/api/v1/staff/ai/jobs', token));
export const enqueueAiJob = async (token: string, input: unknown): Promise<AiJob> =>
  aiJobSchema.parse(
    await call('/api/v1/staff/ai/jobs', token, 'POST', createAiJobRequestSchema.parse(input)),
  );
export const cancelAiJob = async (token: string, id: string): Promise<AiJob> =>
  aiJobSchema.parse(await call(`/api/v1/staff/ai/jobs/${id}/cancel`, token, 'POST'));
export const retryAiJob = async (token: string, id: string): Promise<AiJob> =>
  aiJobSchema.parse(await call(`/api/v1/staff/ai/jobs/${id}/retry`, token, 'POST'));
