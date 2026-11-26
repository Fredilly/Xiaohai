import { listProducts } from '../../services/commerce';
import { clearFailedShopCover } from './shop-display';
import { presentCatalogProduct, type DisplayProduct } from '../../utils/catalog-presentation';

Page({
  data: { q: '', products: [] as DisplayProduct[], loading: true, error: false },
  requestVersion: 0,
  pageClosed: false,
  wasHidden: false,
  onLoad() {
    void this.load();
  },
  onShow() {
    if (this.pageClosed) return;
    const returning = this.wasHidden;
    this.wasHidden = false;
    if (returning) void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.requestVersion++;
  },
  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.requestVersion += 1;
    this.setData({ products: [] });
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ q: String(e.detail.value) });
  },
  search() {
    void this.load();
  },
  async load() {
    if (this.pageClosed || this.wasHidden) return;
    const version = ++this.requestVersion;
    const query = this.data.q;
    this.setData({ products: [], loading: true, error: false });
    try {
      const r = await listProducts(query);
      if (this.pageClosed || this.wasHidden || version !== this.requestVersion) return;
      this.setData({
        products: r.products.map(presentCatalogProduct),
        loading: false,
      });
    } catch {
      if (this.pageClosed || this.wasHidden || version !== this.requestVersion) return;
      this.setData({ loading: false, error: true, products: [] });
    }
  },
  open(e: WechatMiniprogram.TouchEvent) {
    if (this.pageClosed || this.wasHidden || this.data.loading || this.data.error) return;
    const id = String(e.currentTarget.dataset.id ?? '');
    if (!id || !this.data.products.some((product) => product.id === id)) return;
    void wx.navigateTo({ url: `/pages/product/product?id=${encodeURIComponent(id)}` });
  },
  coverError(event: WechatMiniprogram.TouchEvent) {
    if (this.pageClosed || this.wasHidden || this.data.loading) return;
    const index = Number(event.currentTarget.dataset.index);
    const productId = String(event.currentTarget.dataset.id ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    const products = clearFailedShopCover(this.data.products, index, productId, failedUrl);
    if (products !== this.data.products) this.setData({ products });
  },
  cart() {
    if (this.pageClosed || this.wasHidden) return;
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
