import type {
  CreateStoryWorkRequest,
  StoryGenerateRequest,
  StoryGenerationAccepted,
  StoryJobStatus,
  StoryVersion,
  StoryWork,
  StoryWorkDetail,
} from '@xiaohai/contracts/story';
import { getApiBaseUrl } from '../config';

const token = () => String(wx.getStorageSync('consumer_session_token') || '');

export class StoryApiError extends Error {
  constructor(readonly status: number) {
    super(`Story API ${status}`);
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: object): Promise<T> {
  const sessionToken = token();

  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) =>
      wx.request({
        url: `${getApiBaseUrl()}${path}`,
        method,
        data,
        header: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        success: resolve,
        fail: reject,
      }),
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new StoryApiError(response.statusCode);
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

export const saveStoryVersion = (workId: string, jobId: string) =>
  request<StoryVersion>(`/api/v1/ai/story/works/${workId}/versions`, 'POST', { jobId });
