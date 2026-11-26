import { CommerceApiError, listOrders } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';
import { filterOrdersByView, orderViewDefinitions, parseOrderView } from './order-view';

Page({
  readSequence: 0,
  loadedSession: '',
  wasHidden: false,
  pageClosed: false,
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
    if (this.pageClosed) return;
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ orders: [], loading: false });
  },
  onUnload() {
    this.wasHidden = true;
    this.pageClosed = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ orders: [] });
  },
  async load() {
    if (this.wasHidden || this.pageClosed) return;
    const sequence = ++this.readSequence;
    const session = consumerToken();
    this.loadedSession = '';
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
      if (sequence !== this.readSequence || this.wasHidden || this.pageClosed) return false;
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
      this.loadedSession = session;
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
    if (this.pageClosed) return;
    void wx.redirectTo({ url: '/pages/orders/orders' });
  },
  open(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    if (
      !id ||
      this.wasHidden ||
      this.pageClosed ||
      !this.loadedSession ||
      this.loadedSession !== consumerToken() ||
      !this.data.orders.some((order) => order.id === id)
    )
      return;
    void wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${encodeURIComponent(id)}` });
  },
});
