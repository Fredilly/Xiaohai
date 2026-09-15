import { listProducts, type Product } from '../../services/commerce';
Page({
  data: { q: '', products: [] as Product[], loading: true, error: false },
  onLoad() {
    void this.load();
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ q: String(e.detail.value) });
  },
  search() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: false });
    try {
      const r = await listProducts(this.data.q);
      this.setData({ products: r.products, loading: false });
    } catch {
      this.setData({ loading: false, error: true, products: [] });
    }
  },
  open(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },
  cart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
