import { addCartItem, getProduct, type Product } from '../../services/commerce';
Page({
  data: { product: null as Product | null, loading: true, error: false, message: '' },
  onLoad(q: Record<string, string | undefined>) {
    if (q.id) void this.load(q.id);
  },
  async load(id: string) {
    try {
      this.setData({ product: await getProduct(id), loading: false });
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
});
