import { CommerceApiError, listOrders } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';

Page({
  data: {
    orders: [] as Awaited<ReturnType<typeof listOrders>>['orders'],
    loading: true,
    error: false,
    needsLogin: false,
  },
  onShow() {
    void this.load();
  },
  async load() {
    if (!consumerToken()) {
      this.setData({ orders: [], loading: false, error: false, needsLogin: true });
      return;
    }

    this.setData({ loading: true, error: false, needsLogin: false });
    try {
      this.setData({
        orders: (await listOrders()).orders,
        loading: false,
        error: false,
        needsLogin: false,
      });
    } catch (error) {
      const needsLogin = error instanceof CommerceApiError && error.status === 401;
      this.setData({
        orders: [],
        loading: false,
        error: !needsLogin,
        needsLogin,
      });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
  open(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}`,
    });
  },
});
