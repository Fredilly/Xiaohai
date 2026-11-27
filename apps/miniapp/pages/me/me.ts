import { loginWithWeChat } from '../../services/auth';
import { storedConsumerId } from '../../services/consumer-session';
import { getLocalConsumerAvatar, saveLocalConsumerAvatar } from '../../services/consumer-avatar';

type ChooseAvatarEvent = { detail: { avatarUrl?: string } };

const orderActions = [
  { key: 'orders', view: 'unpaid', title: '待付款', icon: 'wallet' },
  { key: 'orders', view: 'shipping', title: '待发货', icon: 'truck' },
  { key: 'orders', view: 'receiving', title: '待收货', icon: 'package' },
  { key: 'orders', view: 'review', title: '待评价', icon: 'star' },
  { key: 'orders', view: 'after-sales', title: '退款/售后', icon: 'return' },
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
      const consumerUserId = storedConsumerId();
      const avatarUrl = getLocalConsumerAvatar(consumerUserId);
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
      if (storedConsumerId() !== result.consumer.id) throw new Error('CONSUMER_SESSION_CHANGED');
      this.setData({
        consumerUserId: result.consumer.id,
        consumerDisplayId: shortId(result.consumer.id),
        avatarUrl: getLocalConsumerAvatar(result.consumer.id),
        isLoggedIn: true,
        status: '欢迎回来',
      });
    } catch {
      // Another login can finish while an older attempt is still awaiting wx.login/request.
      // A rejected old attempt must not blank the currently authenticated account.
      const consumerUserId = storedConsumerId();
      this.setData({
        consumerUserId,
        consumerDisplayId: shortId(consumerUserId),
        avatarUrl: getLocalConsumerAvatar(consumerUserId),
        isLoggedIn: Boolean(consumerUserId),
        status: consumerUserId ? '欢迎回来' : '登录失败，请检查网络后重试',
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },
  chooseAvatar(event: ChooseAvatarEvent) {
    const tempFilePath = String(event.detail.avatarUrl || '');
    const ownerId = storedConsumerId();
    if (!tempFilePath || !ownerId) return;
    wx.saveFile({
      tempFilePath,
      success: ({ savedFilePath }) => {
        if (storedConsumerId() !== ownerId) return;
        saveLocalConsumerAvatar(ownerId, savedFilePath);
        this.setData({ avatarUrl: savedFilePath });
      },
      fail: () => {
        if (storedConsumerId() !== ownerId) return;
        saveLocalConsumerAvatar(ownerId, tempFilePath);
        this.setData({ avatarUrl: tempFilePath });
      },
    });
  },
  openFeature(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '');
    if (key === 'orders') {
      const view = String(event.currentTarget.dataset.view || '');
      void wx.navigateTo({
        url: view
          ? `/pages/orders/orders?view=${encodeURIComponent(view)}`
          : '/pages/orders/orders',
      });
    } else if (key === 'address') void wx.navigateTo({ url: '/pages/address/address' });
    else if (key === 'works') void wx.navigateTo({ url: '/pages/story-works/story-works' });
    else if (key === 'animations') void wx.navigateTo({ url: '/pages/animations/animations' });
    else if (key === 'purchased') void wx.navigateTo({ url: '/pages/purchased/purchased' });
    else if (key === 'my-rental') void wx.navigateTo({ url: '/pages/rentals/rentals' });
    else if (key === 'commission') void wx.navigateTo({ url: '/pages/commission/commission' });
    else if (key === 'settings') void wx.navigateTo({ url: '/pages/settings/settings' });
    else if (key)
      void wx.navigateTo({ url: `/pages/feature/feature?key=${encodeURIComponent(key)}` });
  },
});
