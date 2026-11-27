import { getApiBaseUrl } from '../config';
import { consumerSessionRevision, saveConsumerSession } from './consumer-session';

interface LoginResponse {
  consumer: { id: string };
  session: { token: string; expiresAt: string };
}

let latestLoginAttempt = 0;

export async function loginWithWeChat(): Promise<LoginResponse> {
  const attempt = ++latestLoginAttempt;
  const startingRevision = consumerSessionRevision();
  const checkAttempt = () => {
    if (attempt !== latestLoginAttempt || startingRevision !== consumerSessionRevision()) {
      throw new Error('CONSUMER_SESSION_CHANGED');
    }
  };
  const login = await wx.login();
  checkAttempt();
  if (!login.code) throw new Error('wx.login did not return a code');

  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) => {
      wx.request({
        timeout: 10000,
        url: `${getApiBaseUrl()}/api/v1/auth/wechat/login`,
        method: 'POST',
        data: { code: login.code },
        success: resolve,
        fail: reject,
      });
    },
  );
  checkAttempt();
  if (response.statusCode !== 200 || !isLoginResponse(response.data)) {
    throw new Error('Consumer login failed');
  }
  saveConsumerSession(
    response.data.session.token,
    response.data.session.expiresAt,
    response.data.consumer.id,
  );
  return response.data;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<LoginResponse>;
  return (
    typeof response.consumer?.id === 'string' &&
    response.consumer.id.length > 0 &&
    typeof response.session?.token === 'string' &&
    response.session.token.length > 0 &&
    typeof response.session.expiresAt === 'string' &&
    Number.isFinite(Date.parse(response.session.expiresAt)) &&
    Date.parse(response.session.expiresAt) > Date.now()
  );
}
