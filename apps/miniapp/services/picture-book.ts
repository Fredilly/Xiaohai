import { consumerToken, clearConsumerSession } from './consumer-session';
import type {
  CreatePictureBookRequest,
  PictureBook,
  PictureBookDetail,
  PictureBookGenerationAccepted,
  PictureBookIllustrationAccepted,
  PictureBookJobStatus,
  PictureBookTextOperation,
} from '@xiaohai/contracts/picture-book';
import { getApiBaseUrl } from '../config';

const token = consumerToken;

export class PictureBookApiError extends Error {
  constructor(readonly status: number) {
    super(`Picture Book API ${status}`);
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
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new PictureBookApiError(response.statusCode);
  }
  return response.data as T;
}

export const createPictureBook = (input: CreatePictureBookRequest) =>
  request<PictureBook>('/api/v1/ai/picture-books', 'POST', input);
export const listPictureBooks = () =>
  request<{ pictureBooks: PictureBook[] }>('/api/v1/ai/picture-books');
export const getPictureBook = (id: string) =>
  request<PictureBookDetail>(`/api/v1/ai/picture-books/${id}`);
export const generatePictureBookPlan = (id: string, operation: PictureBookTextOperation) =>
  request<PictureBookGenerationAccepted>(`/api/v1/ai/picture-books/${id}/generate`, 'POST', {
    operation,
  });
export const getPictureBookJob = (id: string) =>
  request<PictureBookJobStatus>(`/api/v1/ai/picture-books/jobs/${id}`);
export const applyPictureBookJob = (bookId: string, jobId: string) =>
  request<PictureBookDetail>(`/api/v1/ai/picture-books/${bookId}/apply`, 'POST', { jobId });
export const generateIllustration = (bookId: string, pageId: string, regenerate = false) =>
  request<PictureBookIllustrationAccepted>(
    `/api/v1/ai/picture-books/${bookId}/pages/${pageId}/illustrations${regenerate ? '/regenerate' : ''}`,
    'POST',
    {},
  );
