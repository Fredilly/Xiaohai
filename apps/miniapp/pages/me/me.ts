import { loginWithWeChat } from '../../services/auth';
import { meFeatures } from '../../services/mock';

Page({
  data: {
    features: meFeatures,
    status: '尚未登录',
    isLoading: false,
    isLoggedIn: false,
    consumerUserId: '',
  },
  onShow() {
    try {
      const app = getApp<IAppOption>();
      const consumerUserId = app.globalData?.consumerUserId || '';
      this.setData({
        consumerUserId,
        isLoggedIn: Boolean(consumerUserId),
        status: consumerUserId ? 'Consumer Session 已建立' : '尚未登录',
      });
    } catch {
      this.setData({
        consumerUserId: '',
        isLoggedIn: false,
        status: '尚未登录',
      });
    }
  },
  async login() {
    this.setData({ isLoading: true, status: '登录中…' });
    try {
      const result = await loginWithWeChat();
      getApp<IAppOption>().globalData.consumerUserId = result.consumer.id;
      this.setData({
        consumerUserId: result.consumer.id,
        isLoggedIn: true,
        status: 'Consumer Session 已建立',
      });
    } catch {
      this.setData({
        consumerUserId: '',
        isLoggedIn: false,
        status: '登录失败，请检查 AppID、网络与后端配置',
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },
  openFeature(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '');
    if (key) {
      void wx.navigateTo({ url: `/pages/feature/feature?key=${encodeURIComponent(key)}` });
    }
  },
});
