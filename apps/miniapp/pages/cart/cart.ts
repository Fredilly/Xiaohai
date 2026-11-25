import { deleteCartItem, getCart, updateCartItem } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';
Page({
  readSequence: 0,
  mutationInFlight: false,
  data: {
    cart: null as Awaited<ReturnType<typeof getCart>> | null,
    loading: true,
    error: false,
    needsLogin: false,
    mutating: false,
    mutationError: '',
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
      this.setData({ cart: null, loading: false, error: false, needsLogin: true });
      return;
    }
    this.setData({ cart: null, loading: true, error: false, needsLogin: false });
    const acceptResponse = () => {
      if (sequence !== this.readSequence || this.mutationInFlight) return false;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ cart: null, loading: false, error: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return false;
      }
      return true;
    };
    try {
      const cart = await getCart();
      if (!acceptResponse()) return;
      this.setData({ cart, loading: false, error: false, needsLogin: false });
    } catch {
      if (acceptResponse()) this.setData({ cart: null, loading: false, error: true });
    }
  },
  async mutate(action: () => Promise<unknown>) {
    if (this.mutationInFlight) return;
    const session = consumerToken();
    if (!session) {
      this.setData({ cart: null, loading: false, needsLogin: true });
      return;
    }
    this.mutationInFlight = true;
    let refreshAfterFailure = false;
    let sessionChanged = false;
    this.readSequence++;
    this.setData({ mutating: true, mutationError: '' });
    try {
      await action();
      if (consumerToken() !== session) {
        sessionChanged = true;
      } else {
        const cart = await getCart();
        if (consumerToken() !== session) sessionChanged = true;
        else this.setData({ cart, loading: false, error: false, needsLogin: false });
      }
    } catch {
      if (consumerToken() !== session) sessionChanged = true;
      else {
        this.setData({ mutationError: '购物车更新未确认，请刷新后再试。' });
        refreshAfterFailure = true;
      }
    } finally {
      this.mutationInFlight = false;
      this.setData({ mutating: false });
    }
    if (sessionChanged) {
      this.setData({ cart: null, loading: true, error: false, mutationError: '' });
      await this.load();
    } else if (refreshAfterFailure) await this.load();
  },
  async plus(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.cart?.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (item && item.quantity < 99) {
      await this.mutate(() => updateCartItem(item.id, item.quantity + 1));
    }
  },
  async minus(e: WechatMiniprogram.TouchEvent) {
    const item = this.data.cart?.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (item && item.quantity > 1) {
      await this.mutate(() => updateCartItem(item.id, item.quantity - 1));
    }
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    await this.mutate(() => deleteCartItem(String(e.currentTarget.dataset.id)));
  },
  checkout() {
    if (
      this.mutationInFlight ||
      this.data.mutating ||
      this.data.error ||
      this.data.needsLogin ||
      !consumerToken() ||
      !this.data.cart?.items.length
    )
      return;
    void wx.navigateTo({ url: '/pages/checkout/checkout' });
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
});
