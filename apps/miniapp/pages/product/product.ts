import { addCartItem, getProduct, type Product } from '../../services/commerce';
import { resolveEditorialBookCover } from '../../utils/real-visuals';

type DisplayProduct = Product & { displayCoverUrl: string };

Page({
  data: {
    id: '',
    product: null as DisplayProduct | null,
    loading: true,
    error: false,
    message: '',
  },
  onLoad(q: Record<string, string | undefined>) {
    const id = q.id ?? '';
    this.setData({ id });
    if (id) void this.load(id);
    else this.setData({ loading: false, error: true });
  },
  async load(id: string) {
    this.setData({ loading: true, error: false, message: '' });
    try {
      const product = await getProduct(id);
      this.setData({
        product: {
          ...product,
          displayCoverUrl: resolveEditorialBookCover(
            product.title ?? product.name,
            product.coverUrl,
          ),
        },
        loading: false,
        error: false,
      });
    } catch {
      this.setData({ loading: false, error: true, product: null });
    }
  },
  retry() {
    if (this.data.id) void this.load(this.data.id);
  },
  async add(e: WechatMiniprogram.TouchEvent) {
    try {
      await addCartItem(String(e.currentTarget.dataset.sku), 1);
      this.setData({ message: '已加入购物车' });
    } catch {
      this.setData({ message: '加入失败；请先登录或检查商品状态' });
    }
  },
  coverError() {
    if (!this.data.product) return;
    this.setData({ 'product.displayCoverUrl': '' });
  },
  openCart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
