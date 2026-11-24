import { listProducts } from '../../services/commerce';
import { clearFailedShopCover } from './shop-display';
import { presentCatalogProduct, type DisplayProduct } from '../../utils/catalog-presentation';

Page({
  data: { q: '', products: [] as DisplayProduct[], loading: true, error: false },
  requestVersion: 0,
  pageClosed: false,
  onLoad() {
    void this.load();
  },
  onUnload() {
    this.pageClosed = true;
    this.requestVersion += 1;
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ q: String(e.detail.value) });
  },
  search() {
    void this.load();
  },
  async load() {
    if (this.pageClosed) return;
    const version = ++this.requestVersion;
    const query = this.data.q;
    this.setData({ loading: true, error: false });
    try {
      const r = await listProducts(query);
      if (this.pageClosed || version !== this.requestVersion) return;
      this.setData({
        products: r.products.map(presentCatalogProduct),
        loading: false,
      });
    } catch {
      if (this.pageClosed || version !== this.requestVersion) return;
      this.setData({ loading: false, error: true, products: [] });
    }
  },
  open(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },
  coverError(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const productId = String(event.currentTarget.dataset.id ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    const products = clearFailedShopCover(this.data.products, index, productId, failedUrl);
    if (products !== this.data.products) this.setData({ products });
  },
  cart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
