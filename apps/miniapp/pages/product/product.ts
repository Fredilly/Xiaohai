import { addCartItem, getProduct } from '../../services/commerce';
import { detailAccessMessage } from '../../utils/detail-read-error';
import { presentCatalogProduct, type DisplayProduct } from '../../utils/catalog-presentation';

Page({
  data: {
    id: '',
    product: null as DisplayProduct | null,
    loading: true,
    error: false,
    accessMessage: '',
    message: '',
  },
  onLoad(q: Record<string, string | undefined>) {
    const id = q.id ?? '';
    this.setData({ id });
    if (id) void this.load(id);
    else this.setData({ loading: false, error: true });
  },
  async load(id: string) {
    this.setData({ loading: true, error: false, accessMessage: '', message: '' });
    try {
      const product = await getProduct(id);
      this.setData({
        product: presentCatalogProduct(product),
        loading: false,
        error: false,
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: true,
        accessMessage: detailAccessMessage(error),
        product: null,
      });
    }
  },
  retry() {
    if (this.data.id && !this.data.loading && !this.data.accessMessage)
      void this.load(this.data.id);
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
    const product = this.data.product;
    if (!product) return;
    const next = product.galleryUrls.filter((url) => url !== product.displayCoverUrl);
    this.setData({
      'product.displayCoverUrl': next[0] ?? '',
      'product.galleryUrls': next,
    });
  },
  galleryError(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product;
    if (!product) return;
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    if (!failedUrl || !product.galleryUrls.includes(failedUrl)) return;
    const next = product.galleryUrls.filter((url) => url !== failedUrl);
    this.setData({
      'product.galleryUrls': next,
      ...(failedUrl === product.displayCoverUrl
        ? { 'product.displayCoverUrl': next[0] ?? '' }
        : {}),
    });
  },
  previewGallery(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product;
    const index = Number(event.currentTarget.dataset.index);
    if (!product || !Number.isInteger(index)) return;
    const current = product.galleryUrls[index];
    if (!current) return;
    void wx.previewImage({ current, urls: product.galleryUrls });
  },
  openCart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
