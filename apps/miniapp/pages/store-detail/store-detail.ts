import type { PublicStore } from '@xiaohai/contracts/stores';
import { getStore } from '../../services/stores';
import { detailAccessMessage } from '../../utils/detail-read-error';

Page({
  data: {
    id: '',
    store: null as PublicStore | null,
    loading: true,
    error: false,
    accessMessage: '',
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

  async loadStore(id: string) {
    this.setData({ loading: true, error: false, accessMessage: '' });
    try {
      const store = await getStore(id);
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
    } catch (error) {
      this.setData({
        loading: false,
        error: true,
        accessMessage: detailAccessMessage(error),
        store: null,
        markers: [],
      });
    }
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
