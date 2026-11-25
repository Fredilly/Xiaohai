import { CommerceApiError, listOrders } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';
import { filterOrdersByView, orderViewDefinitions, parseOrderView } from './order-view';

Page({
  readSequence: 0,
  data: {
    orders: [] as Awaited<ReturnType<typeof listOrders>>['orders'],
    loading: true,
    error: false,
    needsLogin: false,
    view: 'all',
    viewTitle: '我的订单',
    viewNote: '',
    unsupported: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    const view = parseOrderView(query.view);
    const definition = orderViewDefinitions[view];
    this.setData({
      view,
      viewTitle: definition.title,
      viewNote: definition.note,
      unsupported: definition.statuses === null,
    });
  },
  onShow() {
    void this.load();
  },
  onHide() {
    this.readSequence++;
  },
  onUnload() {
    this.readSequence++;
  },
  async load() {
    const sequence = ++this.readSequence;
    const session = consumerToken();
    if (!session) {
      this.setData({ orders: [], loading: false, error: false, needsLogin: true });
      return;
    }

    if (this.data.unsupported) {
      this.setData({ orders: [], loading: false, error: false, needsLogin: false });
      return;
    }

    this.setData({ orders: [], loading: true, error: false, needsLogin: false });
    const acceptResponse = () => {
      if (sequence !== this.readSequence) return false;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ orders: [], loading: false, error: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return false;
      }
      return true;
    };
    try {
      const result = await listOrders();
      if (!acceptResponse()) return;
      this.setData({
        orders: filterOrdersByView(result.orders, parseOrderView(this.data.view)),
        loading: false,
        error: false,
        needsLogin: false,
      });
    } catch (error) {
      if (!acceptResponse()) return;
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
  openAll() {
    void wx.redirectTo({ url: '/pages/orders/orders' });
  },
  open(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}`,
    });
  },
});
