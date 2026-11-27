const tokenKey = 'consumer_session_token';
const expiryKey = 'consumer_session_expires_at';
const userKey = 'consumer_user_id';
let sessionRevision = 0;

/** In-memory fence for login responses started before a logout/account change. */
export function consumerSessionRevision(): number {
  return sessionRevision;
}

export function clearConsumerSession() {
  sessionRevision += 1;
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
  // Missing or malformed expiration is not an authenticated session.
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    clearConsumerSession();
    return '';
  }
  return token;
}

// An old network response must not clear, or publish data into, a newer login.
export function checkConsumerResponse(requestToken: string, statusCode: number): void {
  if (consumerToken() !== requestToken) throw new Error('CONSUMER_SESSION_CHANGED');
  if (statusCode === 401 && requestToken) clearConsumerSession();
}

export function saveConsumerSession(token: string, expiresAt: string, userId: string) {
  sessionRevision += 1;
  wx.setStorageSync(tokenKey, token);
  wx.setStorageSync(expiryKey, expiresAt);
  wx.setStorageSync(userKey, userId);
  if (typeof getApp === 'function') getApp<IAppOption>().globalData.consumerUserId = userId;
}

export function storedConsumerId(): string {
  return consumerToken() ? String(wx.getStorageSync(userKey) || '') : '';
}
