import type { InventoryAvailability, PublicInventoryItem } from '@xiaohai/contracts/inventory';
import { searchInventory } from '../../services/inventory';

type InputEvent = { detail: { value?: string } };
type PickerEvent = { detail: { value?: string | number } };

type InventoryViewItem = PublicInventoryItem & {
  key: string;
  priceText: string;
  distanceText: string;
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
    latitude: null as number | null,
    longitude: null as number | null,
    items: [] as InventoryViewItem[],
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
      const value = result.result.trim();
      if (!value) return;
      this.setData({ query: value });
      await this.submitSearch();
    } catch {
      this.setData({ errorMessage: '未读取到条码，可以手动输入书名、ISBN 或编码。' });
    }
  },

  async useNearby() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const location = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
        (resolve, reject) =>
          wx.getLocation({
            type: 'gcj02',
            success: resolve,
            fail: reject,
          }),
      );
      this.setData({
        nearbyMode: true,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      await this.submitSearch();
    } catch {
      this.setData({ errorMessage: '无法获取位置，请检查微信定位权限。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async disableNearby() {
    this.setData({ nearbyMode: false, latitude: null, longitude: null });
    if (this.data.searched) await this.submitSearch();
  },

  async submitSearch() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const items = await searchInventory({
        q: this.data.query.trim() || undefined,
        availability: availabilityValues[this.data.selectedAvailabilityIndex] ?? 'ANY',
        latitude: this.data.nearbyMode ? (this.data.latitude ?? undefined) : undefined,
        longitude: this.data.nearbyMode ? (this.data.longitude ?? undefined) : undefined,
        radiusKm: this.data.nearbyMode ? 50 : undefined,
        limit: 50,
      });
      this.setData({
        searched: true,
        items: items.map((item) => ({
          ...item,
          key: `${item.sku.id}:${item.store.id}`,
          priceText: `¥${(item.sku.priceMinor / 100).toFixed(2)}`,
          distanceText:
            item.store.distanceKm == null ? '' : `${item.store.distanceKm.toFixed(1)} km`,
        })),
      });
    } catch {
      this.setData({
        searched: true,
        items: [],
        errorMessage: '找书失败，请稍后重试。',
      });
    } finally {
      this.setData({ loading: false });
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

  showDeferredFlow(event: WechatMiniprogram.TouchEvent) {
    const flow = String(event.currentTarget.dataset.flow ?? '该功能');
    void wx.showToast({ title: `${flow}将在后续里程碑开放`, icon: 'none' });
  },
});
