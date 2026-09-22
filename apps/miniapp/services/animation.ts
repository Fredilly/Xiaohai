import { consumerToken, clearConsumerSession } from './consumer-session';
import type {
  Animation,
  AnimationCompositionAccepted,
  AnimationDetail,
  AnimationGenerationAccepted,
  AnimationJobStatus,
  AnimationPlanningOperation,
  AnimationSceneGenerationAccepted,
  CreateAnimationRequest,
} from '@xiaohai/contracts/animation';
import { getApiBaseUrl } from '../config';

const token = consumerToken;

export class AnimationApiError extends Error {
  constructor(readonly status: number) {
    super(`Animation API ${status}`);
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: object): Promise<T> {
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
  if (response.statusCode < 200 || response.statusCode >= 300)
    throw new AnimationApiError(response.statusCode);
  return response.data as T;
}

export const createAnimation = (input: CreateAnimationRequest) =>
  request<Animation>('/api/v1/ai/animations', 'POST', input);
export const listAnimations = () => request<{ animations: Animation[] }>('/api/v1/ai/animations');
export const getAnimation = (id: string) => request<AnimationDetail>(`/api/v1/ai/animations/${id}`);
export const generateAnimationPlan = (id: string, operation: AnimationPlanningOperation) =>
  request<AnimationGenerationAccepted>(`/api/v1/ai/animations/${id}/generate`, 'POST', {
    operation,
  });
export const getAnimationJob = (id: string) =>
  request<AnimationJobStatus>(`/api/v1/ai/animations/jobs/${id}`);
export const applyAnimationJob = (animationId: string, jobId: string) =>
  request<AnimationDetail>(`/api/v1/ai/animations/${animationId}/apply`, 'POST', { jobId });
export const generateScene = (animationId: string, sceneId: string) =>
  request<AnimationSceneGenerationAccepted>(
    `/api/v1/ai/animations/${animationId}/scenes/${sceneId}/generations`,
    'POST',
    {},
  );
export const composeAnimation = (animationId: string, sceneGenerationIds: string[]) =>
  request<AnimationCompositionAccepted>(
    `/api/v1/ai/animations/${animationId}/compositions`,
    'POST',
    { sceneGenerationIds },
  );
