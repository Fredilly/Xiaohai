import { deleteCartItem, getCart, updateCartItem } from '../../services/commerce';
Page({
  readSequence: 0,
  mutationInFlight: false,
  data: {
    cart: null as Awaited<ReturnType<typeof getCart>> | null,
    loading: true,
    error: false,
    mutating: false,
    mutationError: '',
  },
  onShow() {
    void this.load();
  },
  async load() {
    const sequence = ++this.readSequence;
    try {
      const cart = await getCart();
      if (sequence !== this.readSequence || this.mutationInFlight) return;
      this.setData({ cart, loading: false, error: false });
    } catch {
      if (sequence === this.readSequence && !this.mutationInFlight)
        this.setData({ loading: false, error: true });
    }
  },
  async mutate(action: () => Promise<unknown>) {
    if (this.mutationInFlight) return;
    this.mutationInFlight = true;
    let refreshAfterFailure = false;
    this.readSequence++;
    this.setData({ mutating: true, mutationError: '' });
    try {
      await action();
      const cart = await getCart();
      this.setData({ cart, loading: false, error: false });
    } catch {
      this.setData({ mutationError: '购物车更新未确认，请刷新后再试。' });
      refreshAfterFailure = true;
    } finally {
      this.mutationInFlight = false;
      this.setData({ mutating: false });
    }
    if (refreshAfterFailure) await this.load();
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
    if (this.mutationInFlight || this.data.mutating || this.data.error) return;
    void wx.navigateTo({ url: '/pages/checkout/checkout' });
  },
});
