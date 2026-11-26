import type { InventoryAvailability, PublicInventoryItem } from '@xiaohai/contracts/inventory';
import { searchInventory } from '../../services/inventory';
import { createRental } from '../../services/rental';
import { clearFailedBookSearchCover, resolveBookSearchCover } from './book-search-display';

type InputEvent = { detail: { value?: string } };
type PickerEvent = { detail: { value?: string | number } };

type InventoryViewItem = PublicInventoryItem & {
  key: string;
  priceText: string;
  distanceText: string;
  displayCoverUrl: string;
};

const availabilityValues: InventoryAvailability[] = ['ANY', 'SALE', 'RENT'];

Page({
  data: {
    query: '',
    loading: false,
    searched: false,
    errorMessage: '',
    availabilityNames: ['全部有货', '可购买', '可租借'],
    selectedAvailabilityIndex: 0,
    nearbyMode: false,
    locationPending: false,
    latitude: null as number | null,
    longitude: null as number | null,
    items: [] as InventoryViewItem[],
  },
  searchRequestVersion: 0,
  locationRequestVersion: 0,
  pageClosed: false,

  onUnload() {
    this.pageClosed = true;
    this.searchRequestVersion += 1;
    this.locationRequestVersion += 1;
  },

  onLoad(query: Record<string, string | undefined>) {
    const initialQuery = query.q?.trim() ?? '';
    if (initialQuery) {
      this.setData({ query: initialQuery });
      void this.submitSearch();
    }
  },

  onQueryInput(event: InputEvent) {
    this.setData({ query: String(event.detail.value ?? '') });
  },

  async onAvailabilityChange(event: PickerEvent) {
    this.setData({ selectedAvailabilityIndex: Number(event.detail.value ?? 0) });
    if (this.data.searched) await this.submitSearch();
  },

  async scanBookCode() {
    this.setData({ errorMessage: '' });
    try {
      const result = await new Promise<WechatMiniprogram.ScanCodeSuccessCallbackResult>(
        (resolve, reject) =>
          wx.scanCode({
            scanType: ['barCode', 'qrCode'],
            success: resolve,
            fail: reject,
          }),
      );
      if (this.pageClosed) return;
      const value = result.result.trim();
      if (!value) return;
      this.setData({ query: value });
      await this.submitSearch();
    } catch {
      if (!this.pageClosed) {
        this.setData({ errorMessage: '未读取到条码，可以手动输入书名、ISBN 或编码。' });
      }
    }
  },

  async useNearby() {
    if (this.pageClosed) return;
    const locationVersion = ++this.locationRequestVersion;
    let searchStarted = false;
    this.setData({ locationPending: true, loading: true, errorMessage: '' });
    try {
      const location = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
        (resolve, reject) =>
          wx.getLocation({
            type: 'gcj02',
            success: resolve,
            fail: reject,
          }),
      );
      if (this.pageClosed || locationVersion !== this.locationRequestVersion) return;
      this.setData({
        nearbyMode: true,
        locationPending: false,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      searchStarted = true;
      await this.submitSearch();
    } catch {
      if (this.pageClosed || locationVersion !== this.locationRequestVersion) return;
      this.setData({ errorMessage: '无法获取位置，请检查微信定位权限。' });
    } finally {
      if (!this.pageClosed && locationVersion === this.locationRequestVersion) {
        this.setData({
          locationPending: false,
          ...(!searchStarted ? { loading: false } : {}),
        });
      }
    }
  },

  async disableNearby() {
    this.locationRequestVersion += 1;
    this.setData({ locationPending: false, nearbyMode: false, latitude: null, longitude: null });
    if (this.data.searched) await this.submitSearch();
    else this.setData({ loading: false });
  },

  async submitSearch() {
    if (this.pageClosed) return;
    const version = ++this.searchRequestVersion;
    const searchParams = {
      q: this.data.query.trim() || undefined,
      availability: availabilityValues[this.data.selectedAvailabilityIndex] ?? 'ANY',
      latitude: this.data.nearbyMode ? (this.data.latitude ?? undefined) : undefined,
      longitude: this.data.nearbyMode ? (this.data.longitude ?? undefined) : undefined,
      radiusKm: this.data.nearbyMode ? 50 : undefined,
      limit: 50,
    };
    // `searched` also means a first query is in flight: changing filters must
    // supersede it even before the first response arrives.
    this.setData({ searched: true, loading: true, errorMessage: '' });
    try {
      const items = await searchInventory(searchParams);
      if (this.pageClosed || version !== this.searchRequestVersion) return;
      this.setData({
        searched: true,
        items: items.map((item) => ({
          ...item,
          key: `${item.sku.id}:${item.store.id}`,
          priceText: `¥${(item.sku.priceMinor / 100).toFixed(2)}`,
          distanceText:
            item.store.distanceKm == null ? '' : `${item.store.distanceKm.toFixed(1)} km`,
          displayCoverUrl: resolveBookSearchCover(item),
        })),
      });
    } catch {
      if (this.pageClosed || version !== this.searchRequestVersion) return;
      this.setData({
        searched: true,
        items: [],
        errorMessage: '找书失败，请稍后重试。',
      });
    } finally {
      if (!this.pageClosed && version === this.searchRequestVersion) {
        this.setData({ loading: false });
      }
    }
  },

  openStore(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id)
      void wx.navigateTo({ url: `/pages/store-detail/store-detail?id=${encodeURIComponent(id)}` });
  },

  openProduct(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) void wx.navigateTo({ url: `/pages/product/product?id=${encodeURIComponent(id)}` });
  },

  coverError(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const itemKey = String(event.currentTarget.dataset.key ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    const items = clearFailedBookSearchCover(this.data.items, index, itemKey, failedUrl);
    if (items !== this.data.items) this.setData({ items });
  },

  async reserveRental(event: WechatMiniprogram.TouchEvent) {
    const storeId = String(event.currentTarget.dataset.storeId ?? '');
    const skuId = String(event.currentTarget.dataset.skuId ?? '');
    if (!wx.getStorageSync('consumer_session_token')) {
      void wx.showToast({ title: '请先在“我的”完成微信登录', icon: 'none' });
      return;
    }
    try {
      const confirmed = await new Promise<boolean>((resolve) =>
        wx.showModal({
          title: '预约租借',
          content: '确认在该门店预约 1 本？',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        }),
      );
      if (!confirmed) return;
      const rental = await createRental(storeId, skuId);
      void wx.navigateTo({ url: `/pages/rental-detail/rental-detail?id=${rental.id}` });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      void wx.showToast({
        title: code === 'INSUFFICIENT_STOCK' ? '库存不足，预约失败' : '预约失败，请稍后重试',
        icon: 'none',
      });
    }
  },

  showDeferredFlow(event: WechatMiniprogram.TouchEvent) {
    const flow = String(event.currentTarget.dataset.flow ?? '该功能');
    void wx.showToast({ title: `${flow}将在后续里程碑开放`, icon: 'none' });
  },
});
