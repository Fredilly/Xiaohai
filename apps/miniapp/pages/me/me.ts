import { loginWithWeChat } from '../../services/auth';
import { storedConsumerId } from '../../services/consumer-session';

const AVATAR_STORAGE_KEY = 'xiaohai.consumer.avatar';

type ChooseAvatarEvent = { detail: { avatarUrl?: string } };

const orderActions = [
  { key: 'orders', title: '待付款', icon: 'wallet' },
  { key: 'orders', title: '待发货', icon: 'truck' },
  { key: 'orders', title: '待收货', icon: 'package' },
  { key: 'orders', title: '待评价', icon: 'star' },
  { key: 'orders', title: '退款/售后', icon: 'return' },
];

const serviceTiles = [
  { key: 'works', title: 'AI作品', icon: 'magic', tone: 'blue' },
  { key: 'animations', title: 'AI动画', icon: 'play', tone: 'purple' },
  { key: 'purchased', title: '我的动画', icon: 'film', tone: 'pink' },
  { key: 'my-rental', title: '我的租借', icon: 'book', tone: 'green' },
  { key: 'commission', title: '我的佣金', icon: 'coin', tone: 'orange' },
  { key: 'address', title: '地址管理', icon: 'pin', tone: 'cyan' },
  { key: 'member', title: '会员中心', icon: 'crown', tone: 'yellow' },
  { key: 'settings', title: '设置', icon: 'settings', tone: 'navy' },
];

function shortId(value: string): string {
  if (!value) return '';
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

Page({
  data: {
    status: '尚未登录',
    isLoading: false,
    isLoggedIn: false,
    consumerUserId: '',
    consumerDisplayId: '',
    avatarUrl: '',
    orderActions,
    serviceTiles,
  },
  onShow() {
    try {
      const app = getApp<IAppOption>();
      const consumerUserId = storedConsumerId() || app.globalData?.consumerUserId || '';
      const avatarUrl = String(wx.getStorageSync(AVATAR_STORAGE_KEY) || '');
      this.setData({
        consumerUserId,
        consumerDisplayId: shortId(consumerUserId),
        avatarUrl,
        isLoggedIn: Boolean(consumerUserId),
        status: consumerUserId ? '欢迎回来' : '登录后查看订单与个人服务',
      });
    } catch {
      this.setData({
        consumerUserId: '',
        consumerDisplayId: '',
        avatarUrl: '',
        isLoggedIn: false,
        status: '尚未登录',
      });
    }
  },
  async login() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true, status: '登录中…' });
    try {
      const result = await loginWithWeChat();
      getApp<IAppOption>().globalData.consumerUserId = result.consumer.id;
      this.setData({
        consumerUserId: result.consumer.id,
        consumerDisplayId: shortId(result.consumer.id),
        isLoggedIn: true,
        status: '欢迎回来',
      });
    } catch {
      this.setData({
        consumerUserId: '',
        consumerDisplayId: '',
        isLoggedIn: false,
        status: '登录失败，请检查 AppID、网络与后端配置',
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },
  chooseAvatar(event: ChooseAvatarEvent) {
    const tempFilePath = String(event.detail.avatarUrl || '');
    if (!tempFilePath) return;
    wx.saveFile({
      tempFilePath,
      success: ({ savedFilePath }) => {
        wx.setStorageSync(AVATAR_STORAGE_KEY, savedFilePath);
        this.setData({ avatarUrl: savedFilePath });
      },
      fail: () => {
        wx.setStorageSync(AVATAR_STORAGE_KEY, tempFilePath);
        this.setData({ avatarUrl: tempFilePath });
      },
    });
  },
  openFeature(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '');
    if (key === 'orders') void wx.navigateTo({ url: '/pages/orders/orders' });
    else if (key === 'address') void wx.navigateTo({ url: '/pages/address/address' });
    else if (key === 'works') void wx.navigateTo({ url: '/pages/story-works/story-works' });
    else if (key === 'animations') void wx.navigateTo({ url: '/pages/animations/animations' });
    else if (key === 'my-rental') void wx.navigateTo({ url: '/pages/rentals/rentals' });
    else if (key === 'commission') void wx.navigateTo({ url: '/pages/commission/commission' });
    else if (key)
      void wx.navigateTo({ url: `/pages/feature/feature?key=${encodeURIComponent(key)}` });
  },
});
