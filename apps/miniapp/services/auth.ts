import { getApiBaseUrl } from '../config';

interface LoginResponse {
  consumer: { id: string };
  session: { token: string; expiresAt: string };
}

export async function loginWithWeChat(): Promise<LoginResponse> {
  const login = await wx.login();
  if (!login.code) throw new Error('wx.login did not return a code');

  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) => {
      wx.request({
        url: `${getApiBaseUrl()}/api/v1/auth/wechat/login`,
        method: 'POST',
        data: { code: login.code },
        success: resolve,
        fail: reject,
      });
    },
  );
  if (response.statusCode !== 200 || !isLoginResponse(response.data)) {
    throw new Error('Consumer login failed');
  }
  wx.setStorageSync('consumer_session_token', response.data.session.token);
  return response.data;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<LoginResponse>;
  return (
    typeof response.consumer?.id === 'string' &&
    typeof response.session?.token === 'string' &&
    typeof response.session.expiresAt === 'string'
  );
}
