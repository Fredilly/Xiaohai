import { deleteCartItem, getCart, updateCartItem } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';
Page({
  readSequence: 0,
  mutationInFlight: false,
  loadedSession: '',
  wasHidden: false,
  pageClosed: false,
  reloadAfterMutation: false,
  data: {
    cart: null as Awaited<ReturnType<typeof getCart>> | null,
    loading: true,
    error: false,
    needsLogin: false,
    mutating: false,
    mutationError: '',
  },
  onShow() {
    if (this.pageClosed) return;
    this.wasHidden = false;
    if (this.mutationInFlight) {
      this.reloadAfterMutation = true;
      return;
    }
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ cart: null, loading: false, mutationError: '' });
  },
  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ cart: null });
  },
  async load() {
    if (this.wasHidden || this.pageClosed) return;
    if (this.mutationInFlight) {
      this.reloadAfterMutation = true;
      return;
    }
    const sequence = ++this.readSequence;
    const session = consumerToken();
    this.loadedSession = '';
    if (!session) {
      this.setData({ cart: null, loading: false, error: false, needsLogin: true });
      return;
    }
    this.setData({ cart: null, loading: true, error: false, needsLogin: false });
    const acceptResponse = () => {
      if (
        sequence !== this.readSequence ||
        this.mutationInFlight ||
        this.wasHidden ||
        this.pageClosed
      )
        return false;
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
      this.loadedSession = session;
      this.setData({ cart, loading: false, error: false, needsLogin: false });
    } catch {
      if (acceptResponse()) this.setData({ cart: null, loading: false, error: true });
    }
  },
  async mutate(action: () => Promise<unknown>) {
    if (this.mutationInFlight || this.wasHidden || this.pageClosed) return;
    const session = consumerToken();
    if (!session) {
      this.setData({ cart: null, loading: false, needsLogin: true });
      return;
    }
    if (this.loadedSession !== session || !this.data.cart) {
      this.setData({ cart: null, mutationError: '登录状态已变化，请刷新购物车。' });
      void this.load();
      return;
    }
    this.mutationInFlight = true;
    let refreshAfterFailure = false;
    let sessionChanged = false;
    const sequence = ++this.readSequence;
    this.setData({ mutating: true, mutationError: '' });
    try {
      await action();
      if (this.wasHidden || this.pageClosed || sequence !== this.readSequence) {
        // The authorized write may finish server-side; revisit with an owned GET.
      } else if (consumerToken() !== session) {
        sessionChanged = true;
      } else {
        const cart = await getCart();
        if (this.wasHidden || this.pageClosed || sequence !== this.readSequence) {
          // Invalidate stale private read when the page was hidden mid-flight.
        } else if (consumerToken() !== session) sessionChanged = true;
        else this.setData({ cart, loading: false, error: false, needsLogin: false });
      }
    } catch {
      if (this.wasHidden || this.pageClosed || sequence !== this.readSequence) {
        // Hidden failures must not update private UI or silently retry writes.
      } else if (consumerToken() !== session) sessionChanged = true;
      else {
        this.setData({ mutationError: '购物车更新未确认，请刷新后再试。' });
        refreshAfterFailure = true;
      }
    } finally {
      this.mutationInFlight = false;
      if (!this.pageClosed) this.setData({ mutating: false });
    }
    if (this.wasHidden || this.pageClosed) return;
    if (this.reloadAfterMutation) {
      this.reloadAfterMutation = false;
      await this.load();
      return;
    }
    if (sessionChanged) {
      this.setData({ cart: null, loading: true, error: false, mutationError: '' });
      await this.load();
    } else if (refreshAfterFailure) await this.load();
  },
  async plus(e: WechatMiniprogram.TouchEvent) {
    if (this.wasHidden || this.pageClosed || this.loadedSession !== consumerToken()) return;
    const item = this.data.cart?.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (item && item.quantity < 99) {
      await this.mutate(() => updateCartItem(item.id, item.quantity + 1));
    }
  },
  async minus(e: WechatMiniprogram.TouchEvent) {
    if (this.wasHidden || this.pageClosed || this.loadedSession !== consumerToken()) return;
    const item = this.data.cart?.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (item && item.quantity > 1) {
      await this.mutate(() => updateCartItem(item.id, item.quantity - 1));
    }
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    if (this.wasHidden || this.pageClosed || this.loadedSession !== consumerToken()) return;
    const id = String(e.currentTarget.dataset.id || '');
    if (this.data.cart?.items.some((item) => item.id === id))
      await this.mutate(() => deleteCartItem(id));
  },
  checkout() {
    if (
      this.mutationInFlight ||
      this.wasHidden ||
      this.pageClosed ||
      !this.loadedSession ||
      this.loadedSession !== consumerToken() ||
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
