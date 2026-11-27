import type { InventoryAvailability, PublicInventoryItem } from '@xiaohai/contracts/inventory';
import { searchInventory } from '../../services/inventory';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { createRental, randomId } from '../../services/rental';
import { clearRentalKey, pendingRentalKey, persistRentalKey } from '../../services/rental-retry';
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
    reserving: false,
  },
  searchRequestVersion: 0,
  locationRequestVersion: 0,
  rentalReservationInFlight: false,
  rentalWritePending: false,
  reservationViewVersion: 0,
  reservationNeedsReview: false,
  wasHidden: false,
  pageClosed: false,

  onShow() {
    if (this.pageClosed) return;
    const returning = this.wasHidden;
    this.wasHidden = false;
    if (returning && this.data.searched) void this.submitSearch();
    if (this.reservationNeedsReview)
      this.setData({
        errorMessage: '上次租借预约结果请先到“我的租借”核对，避免重复预约。',
      });
  },

  onHide() {
    this.wasHidden = true;
    this.searchRequestVersion++;
    this.locationRequestVersion++;
    this.reservationViewVersion++;
    if (this.rentalWritePending) this.reservationNeedsReview = true;
    this.setData({ items: [], loading: false, locationPending: false });
  },

  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.searchRequestVersion += 1;
    this.locationRequestVersion += 1;
    this.reservationViewVersion += 1;
    this.setData({ items: [], locationPending: false });
  },

  onLoad(query: Record<string, string | undefined>) {
    const initialQuery = query.q?.trim() ?? '';
    if (initialQuery) {
      this.setData({ query: initialQuery });
      void this.submitSearch();
    }
  },

  onQueryInput(event: InputEvent) {
    if (this.pageClosed || this.wasHidden) return;
    this.setData({ query: String(event.detail.value ?? '') });
  },

  async onAvailabilityChange(event: PickerEvent) {
    if (this.pageClosed || this.wasHidden) return;
    this.setData({ selectedAvailabilityIndex: Number(event.detail.value ?? 0) });
    if (this.data.searched) await this.submitSearch();
  },

  async scanBookCode() {
    if (this.pageClosed || this.wasHidden) return;
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
      if (this.pageClosed || this.wasHidden) return;
      const value = result.result.trim();
      if (!value) return;
      this.setData({ query: value });
      await this.submitSearch();
    } catch {
      if (!this.pageClosed && !this.wasHidden) {
        this.setData({ errorMessage: '未读取到条码，可以手动输入书名、ISBN 或编码。' });
      }
    }
  },

  async useNearby() {
    if (this.pageClosed || this.wasHidden || this.data.locationPending) return;
    const locationVersion = ++this.locationRequestVersion;
    let searchStarted = false;
    this.setData({ loading: true, locationPending: true, errorMessage: '' });
    try {
      const location = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
        (resolve, reject) =>
          wx.getLocation({
            type: 'gcj02',
            success: resolve,
            fail: reject,
          }),
      );
      if (this.pageClosed || this.wasHidden || locationVersion !== this.locationRequestVersion)
        return;
      this.setData({
        nearbyMode: true,
        locationPending: false,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      searchStarted = true;
      await this.submitSearch();
    } catch {
      if (this.pageClosed || this.wasHidden || locationVersion !== this.locationRequestVersion)
        return;
      this.setData({ locationPending: false, errorMessage: '无法获取位置，请检查微信定位权限。' });
    } finally {
      if (
        !searchStarted &&
        !this.pageClosed &&
        !this.wasHidden &&
        locationVersion === this.locationRequestVersion
      ) {
        this.setData({ loading: false });
      }
    }
  },

  async disableNearby() {
    if (this.pageClosed || this.wasHidden) return;
    this.locationRequestVersion += 1;
    this.setData({ nearbyMode: false, locationPending: false, latitude: null, longitude: null });
    if (this.data.searched) await this.submitSearch();
    else this.setData({ loading: false });
  },

  async submitSearch() {
    if (this.pageClosed || this.wasHidden) return;
    const version = ++this.searchRequestVersion;
    const searchParams = {
      q: this.data.query.trim() || undefined,
      availability: availabilityValues[this.data.selectedAvailabilityIndex] ?? 'ANY',
      latitude: this.data.nearbyMode ? (this.data.latitude ?? undefined) : undefined,
      longitude: this.data.nearbyMode ? (this.data.longitude ?? undefined) : undefined,
      radiusKm: this.data.nearbyMode ? 50 : undefined,
      limit: 50,
    };
    this.setData({
      items: [],
      loading: true,
      errorMessage: this.reservationNeedsReview
        ? '上次租借预约结果请先到“我的租借”核对，避免重复预约。'
        : '',
    });
    try {
      const items = await searchInventory(searchParams);
      if (this.pageClosed || this.wasHidden || version !== this.searchRequestVersion) return;
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
      if (this.pageClosed || this.wasHidden || version !== this.searchRequestVersion) return;
      this.setData({
        searched: true,
        items: [],
        errorMessage: '找书失败，请稍后重试。',
      });
    } finally {
      if (!this.pageClosed && !this.wasHidden && version === this.searchRequestVersion) {
        this.setData({ loading: false });
      }
    }
  },

  openStore(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (
      id &&
      !this.pageClosed &&
      !this.wasHidden &&
      !this.data.loading &&
      this.data.items.some((item) => item.store.id === id)
    )
      void wx.navigateTo({ url: `/pages/store-detail/store-detail?id=${encodeURIComponent(id)}` });
  },

  openProduct(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (
      id &&
      !this.pageClosed &&
      !this.wasHidden &&
      !this.data.loading &&
      this.data.items.some((item) => item.product.id === id && item.sellAvailable)
    )
      void wx.navigateTo({ url: `/pages/product/product?id=${encodeURIComponent(id)}` });
  },

  coverError(event: WechatMiniprogram.TouchEvent) {
    if (this.pageClosed || this.wasHidden || this.data.loading) return;
    const index = Number(event.currentTarget.dataset.index);
    const itemKey = String(event.currentTarget.dataset.key ?? '');
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    const items = clearFailedBookSearchCover(this.data.items, index, itemKey, failedUrl);
    if (items !== this.data.items) this.setData({ items });
  },

  async reserveRental(event: WechatMiniprogram.TouchEvent) {
    if (this.rentalReservationInFlight || this.pageClosed || this.wasHidden || this.data.loading)
      return;
    const storeId = String(event.currentTarget.dataset.storeId ?? '');
    const skuId = String(event.currentTarget.dataset.skuId ?? '');
    const validListing = () =>
      this.data.items.some(
        (item) => item.store.id === storeId && item.sku.id === skuId && item.rentAvailable,
      );
    if (!validListing()) return;
    const viewVersion = this.reservationViewVersion;
    const searchVersion = this.searchRequestVersion;
    const session = consumerToken();
    const userId = storedConsumerId();
    if (!session || !userId) {
      void wx.showToast({ title: '请先在“我的”完成微信登录', icon: 'none' });
      return;
    }
    this.rentalReservationInFlight = true;
    this.setData({ reserving: true });
    try {
      const pending = pendingRentalKey(userId, storeId, skuId);
      const confirmed = await new Promise<boolean>((resolve) =>
        wx.showModal({
          title: pending ? '核对原预约' : '预约租借',
          content: this.reservationNeedsReview
            ? '上次预约可能已成功，请先到“我的租借”核对；确认没有重复预约后才能再次提交。'
            : pending
              ? '之前的预约结果未确认，继续会使用原请求重试，不会创建另一笔预约。'
              : '确认在该门店预约 1 本？',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        }),
      );
      if (!confirmed) return;
      if (
        this.pageClosed ||
        this.wasHidden ||
        viewVersion !== this.reservationViewVersion ||
        searchVersion !== this.searchRequestVersion ||
        !validListing() ||
        consumerToken() !== session ||
        storedConsumerId() !== userId
      )
        return;
      const key = pending ?? randomId();
      if (!pending) persistRentalKey(userId, storeId, skuId, key);
      this.reservationNeedsReview = false;
      this.rentalWritePending = true;
      const rental = await createRental(storeId, skuId, key);
      if (
        rental.consumerUserId !== userId ||
        rental.storeId !== storeId ||
        rental.items.length !== 1 ||
        rental.items[0]?.skuId !== skuId ||
        rental.items[0]?.quantity !== 1
      )
        throw new Error('RENTAL_CONTEXT_MISMATCH');
      clearRentalKey(userId, storeId, skuId, key);
      if (
        this.pageClosed ||
        this.wasHidden ||
        viewVersion !== this.reservationViewVersion ||
        consumerToken() !== session ||
        storedConsumerId() !== userId
      )
        return;
      void wx.navigateTo({
        url: `/pages/rental-detail/rental-detail?id=${encodeURIComponent(rental.id)}`,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (
        !this.pageClosed &&
        !this.wasHidden &&
        viewVersion === this.reservationViewVersion &&
        consumerToken() === session &&
        storedConsumerId() === userId
      )
        void wx.showToast({
          title:
            code === 'INSUFFICIENT_STOCK' ? '库存不足，预约失败' : '预约未确认，重试沿用原请求',
          icon: 'none',
        });
    } finally {
      this.rentalWritePending = false;
      this.rentalReservationInFlight = false;
      if (!this.pageClosed) this.setData({ reserving: false });
    }
  },

});
