import { listProducts, type Product } from '../../services/commerce';
import { clearFailedShopCover } from './shop-display';
import { resolveEditorialBookCover } from '../../utils/real-visuals';

type DisplayProduct = Product & { displayCoverUrl: string };

Page({
  data: { q: '', products: [] as DisplayProduct[], loading: true, error: false },
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
      this.setData({
        products: r.products.map((product) => ({
          ...product,
          displayCoverUrl: resolveEditorialBookCover(
            product.title ?? product.name,
            product.coverUrl,
          ),
        })),
        loading: false,
      });
    } catch {
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
