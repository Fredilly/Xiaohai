import { addCartItem, getProduct, type Product } from '../../services/commerce';
import { resolveEditorialBookCover } from '../../utils/real-visuals';

type DisplayProduct = Product & { displayCoverUrl: string };

Page({
  data: {
    product: null as DisplayProduct | null,
    loading: true,
    error: false,
    message: '',
  },
  onLoad(q: Record<string, string | undefined>) {
    if (q.id) void this.load(q.id);
  },
  async load(id: string) {
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
      });
    } catch {
      this.setData({ loading: false, error: true });
    }
  },
  async add(e: WechatMiniprogram.TouchEvent) {
    try {
      await addCartItem(String(e.currentTarget.dataset.sku), 1);
      this.setData({ message: '已加入购物车' });
    } catch {
      this.setData({ message: '加入失败；请先登录或检查商品状态' });
    }
  },
  openCart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
