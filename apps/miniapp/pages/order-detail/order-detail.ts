import type { FulfillmentView } from '@xiaohai/contracts/fulfillment';
import { cancelOrder, getOrder } from '../../services/commerce';
import { getFulfillment } from '../../services/fulfillment';
import { payOrder } from '../../services/payments';

Page({
  data: {
    order: null as Awaited<ReturnType<typeof getOrder>> | null,
    fulfillment: null as FulfillmentView | null,
    loading: true,
    error: false,
    id: '',
    paying: false,
    paymentMessage: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    if (query.id) {
      this.setData({ id: query.id });
    } else {
      this.setData({ loading: false, error: true });
    }
  },
  onShow() {
    if (this.data.id) void this.load();
  },

  async load() {
    this.setData({ loading: true, error: false });
    try {
      const order = await getOrder(this.data.id);
      let fulfillment: FulfillmentView | null = null;
      try {
        fulfillment = await getFulfillment(this.data.id);
      } catch {
        // Legacy M5 orders legitimately have no M16 fulfillment record.
      }
      this.setData({ order, fulfillment, loading: false, error: false });
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
