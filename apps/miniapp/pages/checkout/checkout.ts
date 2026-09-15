import { checkout, createOrder, listAddresses, type Address } from '../../services/commerce';
Page({
  data: {
    addresses: [] as Address[],
    addressId: '',
    preview: null as Awaited<ReturnType<typeof checkout>> | null,
    loading: true,
    error: false,
  },
  onLoad() {
    void this.load();
  },
  async load() {
    try {
      const a = (await listAddresses()).addresses;
      const selected = a.find((x) => x.isDefault) || a[0];
      this.setData({ addresses: a, addressId: selected?.id || '', loading: false });
      if (selected) await this.preview(selected.id);
    } catch {
      this.setData({ loading: false, error: true });
    }
  },
  async preview(id: string) {
    this.setData({ preview: await checkout(id) });
  },
  async create() {
    if (!this.data.addressId) return;
    try {
      const order = await createOrder(
        this.data.addressId,
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      void wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${order.id}` });
    } catch {
      this.setData({ error: true });
    }
  },
});
