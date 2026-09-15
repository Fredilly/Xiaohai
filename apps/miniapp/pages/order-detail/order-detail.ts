import { cancelOrder, getOrder } from '../../services/commerce';
Page({
  data: {
    order: null as Awaited<ReturnType<typeof getOrder>> | null,
    loading: true,
    error: false,
    id: '',
  },
  onLoad(q: Record<string, string | undefined>) {
    if (q.id) {
      this.setData({ id: q.id });
      void this.load();
    }
  },
  async load() {
    try {
      this.setData({ order: await getOrder(this.data.id), loading: false, error: false });
    } catch {
      this.setData({ loading: false, error: true });
    }
  },
  async cancel() {
    try {
      await cancelOrder(this.data.id);
      void this.load();
    } catch {
      this.setData({ error: true });
    }
  },
});
