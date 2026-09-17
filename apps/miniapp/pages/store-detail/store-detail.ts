import type { PublicStore } from '@xiaohai/contracts/stores';
import { getStore } from '../../services/stores';

Page({
  data: {
    store: null as PublicStore | null,
    loading: true,
    error: false,
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
    if (query.id) void this.loadStore(query.id);
    else this.setData({ loading: false, error: true });
  },

  async loadStore(id: string) {
    try {
      const store = await getStore(id);
      this.setData({
        store,
        loading: false,
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
    } catch {
      this.setData({ loading: false, error: true });
    }
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
