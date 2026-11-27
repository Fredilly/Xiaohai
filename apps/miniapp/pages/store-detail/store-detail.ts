import type { PublicInventoryItem } from '@xiaohai/contracts/inventory';
import type { PublicStore } from '@xiaohai/contracts/stores';
import { searchInventory } from '../../services/inventory';
import { getStore } from '../../services/stores';
import { detailAccessMessage } from '../../utils/detail-read-error';

type StoreBookView = {
  key: string;
  productId: string;
  title: string;
  author: string;
  isbn: string;
  available: number;
  sellAvailable: boolean;
  rentAvailable: boolean;
  priceText: string;
};

function presentStoreBooks(items: PublicInventoryItem[], storeId: string): StoreBookView[] {
  if (items.some((item) => item.store.id !== storeId)) {
    throw new Error('STORE_INVENTORY_CONTEXT_MISMATCH');
  }
  return items
    .filter((item) => Number.isSafeInteger(item.stock.available) && item.stock.available > 0)
    .map((item) => ({
      key: item.sku.id,
      productId: item.product.id,
      title: item.book.title,
      author: item.book.author,
      isbn: item.book.isbn ?? '',
      available: item.stock.available,
      sellAvailable: item.sellAvailable,
      rentAvailable: item.rentAvailable,
      priceText: `¥${(item.sku.priceMinor / 100).toFixed(2)}`,
    }));
}

Page({
  readSequence: 0,
  inventorySequence: 0,
  wasHidden: false,
  pageClosed: false,
  data: {
    id: '',
    store: null as PublicStore | null,
    loading: true,
    error: false,
    accessMessage: '',
    inventoryQuery: '',
    inventoryLoading: false,
    inventoryError: false,
    inventoryItems: [] as StoreBookView[],
    markers: [] as Array<{
      id: number;
      latitude: number;
      longitude: number;
      title: string;
      width: number;
      height: number;
    }>,
  },

  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ?? '';
    this.setData({ id });
    if (id) void this.loadStore(id);
    else this.setData({ loading: false, error: true });
  },

  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.inventorySequence++;
    this.setData({ inventoryItems: [], inventoryLoading: false });
  },

  onShow() {
    if (this.pageClosed || !this.wasHidden) return;
    this.wasHidden = false;
    if (this.data.id) void this.loadStore(this.data.id);
  },

  onUnload() {
    this.pageClosed = true;
    this.readSequence++;
    this.inventorySequence++;
    this.setData({ store: null, inventoryItems: [], inventoryLoading: false });
  },

  async loadStore(id: string) {
    if (this.wasHidden || this.pageClosed || this.data.id !== id) return;
    const sequence = ++this.readSequence;
    this.inventorySequence++;
    this.setData({
      loading: true,
      error: false,
      accessMessage: '',
      inventoryItems: [],
      inventoryLoading: false,
      inventoryError: false,
    });
    try {
      const store = await getStore(id);
      if (
        sequence !== this.readSequence ||
        this.data.id !== id ||
        this.wasHidden ||
        this.pageClosed
      )
        return;
      if (store.id !== id) throw new Error('STORE_CONTEXT_MISMATCH');
      this.setData({
        store,
        loading: false,
        error: false,
        markers: [
          {
            id: 1,
            latitude: store.latitude,
            longitude: store.longitude,
            title: store.name,
            width: 30,
            height: 30,
          },
        ],
      });
      void wx.setNavigationBarTitle({ title: store.name });
      void this.loadInventory(id);
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
        store: null,
        markers: [],
      });
    }
  },

  onInventoryQueryInput(event: { detail: { value?: string } }) {
    if (this.wasHidden || this.pageClosed) return;
    this.setData({ inventoryQuery: String(event.detail.value ?? '').slice(0, 120) });
  },

  searchStoreBooks() {
    if (!this.data.loading && this.data.store?.id === this.data.id)
      void this.loadInventory(this.data.id);
  },

  async loadInventory(id: string) {
    if (this.wasHidden || this.pageClosed || this.data.store?.id !== id || this.data.id !== id)
      return;
    const sequence = ++this.inventorySequence;
    const query = this.data.inventoryQuery.trim();
    this.setData({ inventoryLoading: true, inventoryError: false, inventoryItems: [] });
    try {
      const items = await searchInventory({ storeId: id, q: query || undefined, limit: 30 });
      if (
        sequence !== this.inventorySequence ||
        this.wasHidden ||
        this.pageClosed ||
        this.data.id !== id
      )
        return;
      this.setData({ inventoryItems: presentStoreBooks(items, id) });
    } catch {
      if (
        sequence !== this.inventorySequence ||
        this.wasHidden ||
        this.pageClosed ||
        this.data.id !== id
      )
        return;
      this.setData({ inventoryItems: [], inventoryError: true });
    } finally {
      if (
        sequence === this.inventorySequence &&
        !this.wasHidden &&
        !this.pageClosed &&
        this.data.id === id
      )
        this.setData({ inventoryLoading: false });
    }
  },

  openInventoryProduct(event: WechatMiniprogram.TouchEvent) {
    const productId = String(event.currentTarget.dataset.id ?? '');
    if (
      !productId ||
      this.wasHidden ||
      this.pageClosed ||
      this.data.inventoryLoading ||
      !this.data.inventoryItems.some((item) => item.productId === productId && item.sellAvailable)
    )
      return;
    void wx.navigateTo({ url: `/pages/product/product?id=${encodeURIComponent(productId)}` });
  },

  retry() {
    if (this.data.id && !this.data.loading && !this.data.accessMessage)
      void this.loadStore(this.data.id);
  },

  navigate() {
    const store = this.data.store;
    if (!store) return;
    void wx.openLocation({
      latitude: store.latitude,
      longitude: store.longitude,
      name: store.name,
      address: store.addressLine,
      scale: 16,
    });
  },

  callStore() {
    const phone = this.data.store?.phone;
    if (phone) void wx.makePhoneCall({ phoneNumber: phone });
  },
});
