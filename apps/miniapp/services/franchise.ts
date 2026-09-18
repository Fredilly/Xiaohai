import type {
  CreateFranchiseApplicationRequest,
  FranchiseApplicationSubmissionResponse,
} from '@xiaohai/contracts/franchise';
import { getApiBaseUrl } from '../config';

export async function submitFranchiseApplication(
  input: CreateFranchiseApplicationRequest,
): Promise<FranchiseApplicationSubmissionResponse> {
  const token = String(wx.getStorageSync('consumer_session_token') || '');
  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) =>
      wx.request({
        url: `${getApiBaseUrl()}/api/v1/franchise/applications`,
        method: 'POST',
        data: input as unknown as WechatMiniprogram.IAnyObject,
        header: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        success: resolve,
        fail: reject,
      }),
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = response.data as { error?: { code?: string } };
    throw new Error(body?.error?.code ?? `HTTP_${response.statusCode}`);
  }

  return response.data as FranchiseApplicationSubmissionResponse;
}
