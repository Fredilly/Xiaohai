import { clearLocalConsumerAvatar, getLocalConsumerAvatar } from '../../services/consumer-avatar';
import { clearConsumerSession, consumerToken, storedConsumerId } from '../../services/consumer-session';

Page({
  data: {
    isLoggedIn: false,
    consumerDisplayId: '',
    avatarSaved: false,
    notice: '',
  },
  onShow() {
    const userId = storedConsumerId();
    this.setData({
      isLoggedIn: Boolean(userId),
      consumerDisplayId: userId ? `${userId.slice(0, 8)}…` : '',
      avatarSaved: Boolean(getLocalConsumerAvatar(userId)),
      notice: '',
    });
  },
  clearAvatar() {
    if (!this.data.avatarSaved) return;
    const ownerId = storedConsumerId();
    const session = consumerToken();
    if (!ownerId || !session) return;
    wx.showModal({
      title: '清除本机头像',
      content: '仅清除此设备保存的头像，不会删除账号、作品或订单。',
      confirmText: '清除',
      success: ({ confirm }) => {
        if (!confirm) return;
        // A confirmation can remain open while the account changes elsewhere.
        // Never let an old dialog delete the new account's saved avatar.
        if (storedConsumerId() !== ownerId || consumerToken() !== session) {
          void this.onShow();
          return;
        }
        clearLocalConsumerAvatar();
        this.setData({ avatarSaved: false, notice: '本机头像已清除' });
      },
    });
  },
  logout() {
    if (!this.data.isLoggedIn) return;
    const ownerId = storedConsumerId();
    const session = consumerToken();
    if (!ownerId || !session) return;
    wx.showModal({
      title: '退出登录',
      content: '仅清除此设备保存的登录状态，不会删除账号、订单或作品。',
      confirmText: '退出',
      success: ({ confirm }) => {
        if (!confirm) return;
        // Do not log out a different account (or a newly refreshed session).
        if (storedConsumerId() !== ownerId || consumerToken() !== session) {
          void this.onShow();
          return;
        }
        clearConsumerSession();
        clearLocalConsumerAvatar();
        this.setData({
          isLoggedIn: false,
          consumerDisplayId: '',
          avatarSaved: false,
          notice: '已退出当前设备登录',
        });
      },
    });
  },
});
