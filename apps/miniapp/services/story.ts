import { consumerToken, clearConsumerSession } from './consumer-session';
import type {
  CreateStoryWorkRequest,
  StoryContentKind,
  StoryDraft,
  StoryGenerateRequest,
  StoryGenerationAccepted,
  StoryJobStatus,
  StoryVersion,
  StoryWork,
  StoryWorkDetail,
} from '@xiaohai/contracts/story';
import { getApiBaseUrl } from '../config';

const token = consumerToken;

export class StoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(`Story API ${status}`);
  }
}

function responseErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: object,
): Promise<T> {
  const sessionToken = token();

  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) =>
      wx.request({
        timeout: 10000,
        url: `${getApiBaseUrl()}${path}`,
        method,
        data,
        header: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        success: resolve,
        fail: reject,
      }),
  );

  if (response.statusCode === 401) clearConsumerSession();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new StoryApiError(response.statusCode, responseErrorCode(response.data));
  }

  return response.data as T;
}

export const createStoryWork = (input: CreateStoryWorkRequest) =>
  request<StoryWork>('/api/v1/ai/story/works', 'POST', input);

export const listStoryWorks = () => request<{ works: StoryWork[] }>('/api/v1/ai/story/works');

export const getStoryWork = (id: string) =>
  request<StoryWorkDetail>(`/api/v1/ai/story/works/${id}`);

export const generateStory = (workId: string, input: StoryGenerateRequest) =>
  request<StoryGenerationAccepted>(`/api/v1/ai/story/works/${workId}/generate`, 'POST', input);

export const getStoryJob = (jobId: string) =>
  request<StoryJobStatus>(`/api/v1/ai/story/jobs/${jobId}`);

export const createStoryDraftFromJob = (workId: string, jobId: string) =>
  request<StoryDraft>(`/api/v1/ai/story/works/${workId}/drafts/from-job`, 'POST', {
    jobId,
  });

export const updateStoryDraft = (
  workId: string,
  contentKind: StoryContentKind,
  content: string,
  expectedRevision: number,
) =>
  request<StoryDraft>(`/api/v1/ai/story/works/${workId}/drafts/${contentKind}`, 'PUT', {
    content,
    expectedRevision,
  });

export const discardStoryDraft = (
  workId: string,
  contentKind: StoryContentKind,
  expectedRevision: number,
) =>
  request<{ discarded: true }>(`/api/v1/ai/story/works/${workId}/drafts/${contentKind}`, 'DELETE', {
    expectedRevision,
  });

export const confirmStoryDraft = (
  workId: string,
  contentKind: StoryContentKind,
  expectedRevision: number,
) =>
  request<StoryVersion>(`/api/v1/ai/story/works/${workId}/versions`, 'POST', {
    contentKind,
    expectedRevision,
  });
