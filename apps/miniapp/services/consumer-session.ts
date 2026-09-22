const tokenKey = 'consumer_session_token';
const expiryKey = 'consumer_session_expires_at';
const userKey = 'consumer_user_id';

export function clearConsumerSession() {
  wx.removeStorageSync(tokenKey);
  wx.removeStorageSync(expiryKey);
  wx.removeStorageSync(userKey);
  if (typeof getApp === 'function') getApp<IAppOption>().globalData.consumerUserId = '';
}

export function consumerToken(): string {
  const token = String(wx.getStorageSync(tokenKey) || '');
  if (!token) return '';
  const expiresAt = String(wx.getStorageSync(expiryKey) || '');
  const expiry = Date.parse(expiresAt);
  if (Number.isFinite(expiry) && expiry <= Date.now()) {
    clearConsumerSession();
    return '';
  }
  return token;
}

export function saveConsumerSession(token: string, expiresAt: string, userId: string) {
  wx.setStorageSync(tokenKey, token);
  wx.setStorageSync(expiryKey, expiresAt);
  wx.setStorageSync(userKey, userId);
  if (typeof getApp === 'function') getApp<IAppOption>().globalData.consumerUserId = userId;
}

export function storedConsumerId(): string {
  return consumerToken() ? String(wx.getStorageSync(userKey) || '') : '';
}
