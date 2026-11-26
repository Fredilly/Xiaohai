import {
  clearLocalConsumerAvatar,
  CONSUMER_AVATAR_STORAGE_KEY,
} from '../../services/consumer-avatar';
import { clearConsumerSession, storedConsumerId } from '../../services/consumer-session';

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
      avatarSaved: Boolean(wx.getStorageSync(CONSUMER_AVATAR_STORAGE_KEY)),
      notice: '',
    });
  },
  clearAvatar() {
    if (!this.data.avatarSaved) return;
    wx.showModal({
      title: '清除本机头像',
      content: '仅清除此设备保存的头像，不会删除账号、作品或订单。',
      confirmText: '清除',
      success: ({ confirm }) => {
        if (!confirm) return;
        clearLocalConsumerAvatar();
        this.setData({ avatarSaved: false, notice: '本机头像已清除' });
      },
    });
  },
  logout() {
    if (!this.data.isLoggedIn) return;
    wx.showModal({
      title: '退出登录',
      content: '仅清除此设备保存的登录状态，不会删除账号、订单或作品。',
      confirmText: '退出',
      success: ({ confirm }) => {
        if (!confirm) return;
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
