import type { PublicRegion, PublicStore } from '@xiaohai/contracts/stores';
import { listRegions, listStores } from '../../services/stores';

type StoreMarker = {
  id: number;
  latitude: number;
  longitude: number;
  title: string;
  width: number;
  height: number;
};

type InputEvent = { detail: { value?: string } };
type PickerEvent = { detail: { value?: string | number } };

Page({
  data: {
    loading: false,
    errorMessage: '',
    query: '',
    regions: [] as PublicRegion[],
    regionNames: ['全部区域'],
    selectedRegionIndex: 0,
    stores: [] as PublicStore[],
    nearbyMode: false,
    latitude: null as number | null,
    longitude: null as number | null,
    mapLatitude: 30.657,
    mapLongitude: 104.066,
    markers: [] as StoreMarker[],
  },

  async onLoad() {
    await this.loadInitialData();
  },

  async loadInitialData() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const [regions, stores] = await Promise.all([listRegions(), listStores()]);
      this.applyStores(stores);
      this.setData({
        regions,
        regionNames: ['全部区域', ...regions.map((region) => region.name)],
      });
    } catch {
      this.setData({ errorMessage: '门店信息加载失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onQueryInput(event: InputEvent) {
    this.setData({ query: String(event.detail.value ?? '') });
  },

  async submitSearch() {
    await this.refreshStores();
  },

  async clearSearch() {
    this.setData({ query: '' });
    await this.refreshStores();
  },

  async onRegionChange(event: PickerEvent) {
    this.setData({ selectedRegionIndex: Number(event.detail.value ?? 0) });
    await this.refreshStores();
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
      await this.refreshStores();
    } catch {
      this.setData({ errorMessage: '无法获取位置，请检查微信定位权限。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async disableNearby() {
    this.setData({ nearbyMode: false, latitude: null, longitude: null });
    await this.refreshStores();
  },

  async refreshStores() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const selectedRegion =
        this.data.selectedRegionIndex > 0
          ? this.data.regions[this.data.selectedRegionIndex - 1]
          : undefined;
      const stores = await listStores({
        q: this.data.query || undefined,
        regionId: selectedRegion?.id,
        latitude: this.data.nearbyMode ? (this.data.latitude ?? undefined) : undefined,
        longitude: this.data.nearbyMode ? (this.data.longitude ?? undefined) : undefined,
        radiusKm: this.data.nearbyMode ? 50 : undefined,
      });
      this.applyStores(stores);
    } catch {
      this.setData({ errorMessage: '门店搜索失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyStores(stores: PublicStore[]) {
    const first = stores[0];
    this.setData({
      stores,
      mapLatitude: first?.latitude ?? this.data.latitude ?? 30.657,
      mapLongitude: first?.longitude ?? this.data.longitude ?? 104.066,
      markers: stores.map((store, index) => ({
        id: index + 1,
        latitude: store.latitude,
        longitude: store.longitude,
        title: store.name,
        width: 28,
        height: 28,
      })),
    });
  },

  scrollToStores() {
    void wx.pageScrollTo({ selector: '#store-list', duration: 300 });
  },

  scrollToMap() {
    void wx.pageScrollTo({ selector: '#store-map', duration: 300 });
  },

  openRentals() {
    void wx.navigateTo({ url: '/pages/rentals/rentals' });
  },

  openBookSearch() {
    void wx.navigateTo({ url: '/pages/book-search/book-search' });
  },

  openFranchise() {
    void wx.navigateTo({ url: '/pages/franchise-apply/franchise-apply' });
  },

  openStore(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id)
      void wx.navigateTo({ url: `/pages/store-detail/store-detail?id=${encodeURIComponent(id)}` });
  },
});
