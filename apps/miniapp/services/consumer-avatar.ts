// Device-local UI preference, independent of the server-side consumer profile.
export const CONSUMER_AVATAR_STORAGE_KEY = 'xiaohai.consumer.avatar';

/** Clears only the avatar owned by this mini program; never touches account data. */
export function clearLocalConsumerAvatar(): void {
  const filePath = String(wx.getStorageSync(CONSUMER_AVATAR_STORAGE_KEY) || '');
  wx.removeStorageSync(CONSUMER_AVATAR_STORAGE_KEY);
  // A successfully saved avatar is a persistent WeChat file. Temporary paths
  // are not managed by removeSavedFile, so cleanup is best effort.
  if (filePath && typeof wx.removeSavedFile === 'function') {
    wx.removeSavedFile({ filePath, fail: () => undefined });
  }
}
