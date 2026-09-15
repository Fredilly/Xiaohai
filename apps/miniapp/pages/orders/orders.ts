import { listOrders } from '../../services/commerce';
Page({
  data: {
    orders: [] as Awaited<ReturnType<typeof listOrders>>['orders'],
    loading: true,
    error: false,
  },
  onShow() {
    void this.load();
  },
  async load() {
    try {
      this.setData({ orders: (await listOrders()).orders, loading: false, error: false });
    } catch {
      this.setData({ loading: false, error: true });
    }
  },
  open(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}`,
    });
  },
});
