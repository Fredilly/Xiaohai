import { addCartItem, getProduct, type Product } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';
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
  addInFlight: false,
  readSequence: 0,
  wasHidden: false,
  pageClosed: false,
  reloadOnShow: false,
  pendingCartReview: false,
  data: {
    id: '',
    product: null as DisplayProduct | null,
    loading: true,
    error: false,
    accessMessage: '',
    message: '',
    addingSku: '',
  },
  onLoad(q: Record<string, string | undefined>) {
    const id = q.id ?? '';
    this.setData({ id });
    if (id) void this.load(id);
    else this.setData({ loading: false, error: true });
  },
  onShow() {
    if (this.pageClosed) return;
    this.wasHidden = false;
    if (this.reloadOnShow && this.data.id) {
      this.reloadOnShow = false;
      void this.load(this.data.id);
    }
  },
  onHide() {
    this.wasHidden = true;
    this.reloadOnShow = true;
    if (this.addInFlight) this.pendingCartReview = true;
    this.readSequence++;
    this.setData({ product: null, loading: false, message: '' });
  },
  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.readSequence++;
    this.setData({ product: null, message: '' });
  },
  async load(id: string) {
    if (this.wasHidden || this.pageClosed) return;
    const sequence = ++this.readSequence;
    this.setData({ product: null, loading: true, error: false, accessMessage: '', message: '' });
    try {
      const product = await getProduct(id);
      if (
        sequence !== this.readSequence ||
        this.data.id !== id ||
        this.wasHidden ||
        this.pageClosed
      )
        return;
      if (product.id !== id) throw new Error('PRODUCT_CONTEXT_MISMATCH');
      this.setData({
        product: {
          ...presentCatalogProduct(product),
          gallery: detailGallery(product),
        },
        loading: false,
        error: false,
        ...(this.pendingCartReview
          ? { message: '上次加入购物车的结果，请先到购物车核对后再试。' }
          : {}),
      });
      this.pendingCartReview = false;
    } catch (error) {
      if (
        sequence !== this.readSequence ||
        this.data.id !== id ||
        this.wasHidden ||
        this.pageClosed
      )
        return;
      this.setData({
        loading: false,
        error: true,
        accessMessage: detailAccessMessage(error),
        product: null,
      });
    }
  },
  retry() {
    if (
      !this.wasHidden &&
      !this.pageClosed &&
      this.data.id &&
      !this.data.loading &&
      !this.data.accessMessage
    )
      void this.load(this.data.id);
  },
  async add(e: WechatMiniprogram.TouchEvent) {
    if (this.addInFlight || this.wasHidden || this.pageClosed) return;
    const skuId = String(e.currentTarget.dataset.sku ?? '');
    if (!this.data.product?.skus.some((sku) => sku.id === skuId && sku.availableForSale)) return;
    const session = consumerToken();
    if (!session) {
      this.setData({ message: '请先微信登录后加入购物车。' });
      return;
    }
    const productId = this.data.product.id;
    const sequence = this.readSequence;
    const canPublish = () =>
      !this.wasHidden &&
      !this.pageClosed &&
      this.readSequence === sequence &&
      this.data.product?.id === productId &&
      consumerToken() === session;
    this.addInFlight = true;
    this.setData({ addingSku: skuId, message: '' });
    try {
      await addCartItem(skuId, 1);
      if (canPublish()) this.setData({ message: '已加入购物车' });
    } catch {
      if (canPublish())
        this.setData({ message: '加入结果未确认，请先查看购物车再重试，避免重复添加。' });
    } finally {
      this.addInFlight = false;
      if (!this.pageClosed) {
        this.setData({ addingSku: '' });
        if (!this.wasHidden && consumerToken() !== session)
          this.setData({ message: '登录状态已变化，请核对当前账号的购物车。' });
        else if (
          !this.wasHidden &&
          this.readSequence !== sequence &&
          this.data.product?.id === productId
        )
          this.setData({ message: '加入结果请以购物车为准，重试前请先核对。' });
      }
    }
  },
  coverError(event: WechatMiniprogram.TouchEvent) {
    if (this.wasHidden || this.pageClosed) return;
    const product = this.data.product;
    const id = String(event.currentTarget.dataset.id ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    // A previous image may fail after a new product/cover has already loaded.
    if (!product || product.id !== id || !failedUrl || product.displayCoverUrl !== failedUrl)
      return;
    this.setData({ 'product.displayCoverUrl': '' });
  },
  galleryError(event: WechatMiniprogram.TouchEvent) {
    if (this.wasHidden || this.pageClosed) return;
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
    if (this.wasHidden || this.pageClosed) return;
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
    if (this.addInFlight || this.wasHidden || this.pageClosed) return;
    void wx.navigateTo({ url: '/pages/cart/cart' });
  },
});
