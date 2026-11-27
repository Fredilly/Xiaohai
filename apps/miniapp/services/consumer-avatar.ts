// Device-local UI preference, independent of the server-side consumer profile.
export const CONSUMER_AVATAR_STORAGE_KEY = 'xiaohai.consumer.avatar';
export const CONSUMER_AVATAR_OWNER_KEY = 'xiaohai.consumer.avatar.owner';

/** Device-local avatars must never be displayed for another signed-in account. */
export function getLocalConsumerAvatar(userId: string): string {
  if (!userId || wx.getStorageSync(CONSUMER_AVATAR_OWNER_KEY) !== userId) return '';
  return String(wx.getStorageSync(CONSUMER_AVATAR_STORAGE_KEY) || '');
}

export function saveLocalConsumerAvatar(userId: string, filePath: string): void {
  if (!userId || !filePath) return;
  wx.setStorageSync(CONSUMER_AVATAR_OWNER_KEY, userId);
  wx.setStorageSync(CONSUMER_AVATAR_STORAGE_KEY, filePath);
}

/** Clears only the avatar owned by this mini program; never touches account data. */
export function clearLocalConsumerAvatar(): void {
  const filePath = String(wx.getStorageSync(CONSUMER_AVATAR_STORAGE_KEY) || '');
  wx.removeStorageSync(CONSUMER_AVATAR_STORAGE_KEY);
  wx.removeStorageSync(CONSUMER_AVATAR_OWNER_KEY);
  // A successfully saved avatar is a persistent WeChat file. Temporary paths
  // are not managed by removeSavedFile, so cleanup is best effort.
  if (filePath && typeof wx.removeSavedFile === 'function') {
    wx.removeSavedFile({ filePath, fail: () => undefined });
  }
}
