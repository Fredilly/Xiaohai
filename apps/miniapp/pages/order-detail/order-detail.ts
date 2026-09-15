import { cancelOrder, getOrder } from '../../services/commerce';
import { payOrder } from '../../services/payments';
Page({
  data: {
    order: null as Awaited<ReturnType<typeof getOrder>> | null,
    loading: true,
    error: false,
    id: '',
    paying: false,
    paymentMessage: '',
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
  async pay() {
    if (this.data.paying) return;
    this.setData({ paying: true, paymentMessage: '' });
    try {
      await payOrder(this.data.id);
      this.setData({ paymentMessage: '支付结果以服务端订单状态为准，请刷新确认。' });
    } catch {
      this.setData({ paymentMessage: '支付未完成或暂不可用。请刷新订单确认，勿重复付款。' });
    } finally {
      this.setData({ paying: false });
      await this.load();
    }
  },
});
