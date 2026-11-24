import { addCartItem, getProduct, type Product } from '../../services/commerce';
import { detailAccessMessage } from '../../utils/detail-read-error';
import {
  presentCatalogProduct,
  type DisplayProduct as PresentedProduct,
} from '../../utils/catalog-presentation';

type DisplayProduct = PresentedProduct & {
  displayCoverUrl: string;
  gallery: Array<{ key: number; url: string }>;
};

function detailGallery(product: Product): DisplayProduct['gallery'] {
  const seen = new Set<string>(product.coverUrl ? [product.coverUrl] : []);
  const gallery: DisplayProduct['gallery'] = [];
  for (const url of product.mediaUrls ?? []) {
    if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
    seen.add(url);
    gallery.push({ key: gallery.length, url });
    if (gallery.length === 12) break;
  }
  return gallery;
}

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
        product: {
          ...presentCatalogProduct(product),
          gallery: detailGallery(product),
        },
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
  coverError(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product;
    const id = String(event.currentTarget.dataset.id ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    // A previous image may fail after a new product/cover has already loaded.
    if (!product || product.id !== id || !failedUrl || product.displayCoverUrl !== failedUrl)
      return;
    this.setData({ 'product.displayCoverUrl': '' });
  },
  galleryError(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product;
    const id = String(event.currentTarget.dataset.id ?? '');
    const index = Number(event.currentTarget.dataset.index);
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    if (
      !product ||
      product.id !== id ||
      !Number.isInteger(index) ||
      index < 0 ||
      !failedUrl ||
      product.gallery[index]?.url !== failedUrl
    )
      return;
    this.setData({
      'product.gallery': product.gallery.map((image, current) =>
        current === index ? { ...image, url: '' } : image,
      ),
    });
  },
  previewGallery(event: WechatMiniprogram.TouchEvent) {
    const product = this.data.product;
    const id = String(event.currentTarget.dataset.id ?? '');
    const current = String(event.currentTarget.dataset.src ?? '');
    if (!product || product.id !== id || !current) return;
    const urls = [
      ...new Set(
        [product.displayCoverUrl, ...product.gallery.map((image) => image.url)].filter(Boolean),
      ),
    ];
    if (urls.includes(current)) void wx.previewImage({ current, urls });
  },
  openCart() {
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
