import type { FulfillmentView } from '@xiaohai/contracts/fulfillment';
import { cancelOrder, getOrder } from '../../services/commerce';
import { getFulfillment } from '../../services/fulfillment';
import { payOrder } from '../../services/payments';
import { consumerToken } from '../../services/consumer-session';

Page({
  readSequence: 0,
  visibleSession: '',
  cancelling: false,
  data: {
    order: null as Awaited<ReturnType<typeof getOrder>> | null,
    fulfillment: null as FulfillmentView | null,
    fulfillmentError: false,
    loading: true,
    error: false,
    id: '',
    paying: false,
    cancellingOrder: false,
    cancelMessage: '',
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
  onHide() {
    this.readSequence++;
    this.visibleSession = '';
    this.setData({ order: null, fulfillment: null, cancelMessage: '', paymentMessage: '' });
  },
  onUnload() {
    this.readSequence++;
    this.visibleSession = '';
  },

  async load() {
    const sequence = ++this.readSequence;
    const orderId = this.data.id;
    const session = consumerToken();
    this.visibleSession = '';
    this.setData({ order: null, fulfillment: null, loading: true, error: false });
    if (!session) {
      this.setData({ loading: false, error: true });
      return;
    }
    try {
      const order = await getOrder(orderId);
      if (sequence !== this.readSequence || orderId !== this.data.id) return;
      if (consumerToken() !== session) {
        this.setData({ order: null, fulfillment: null, loading: false, error: true });
        return;
      }
      if (order.id !== orderId) throw new Error('ORDER_CONTEXT_MISMATCH');
      let fulfillment: FulfillmentView | null = null;
      let fulfillmentError = false;
      try {
        fulfillment = await getFulfillment(orderId);
        if (fulfillment.orderId !== orderId) throw new Error('FULFILLMENT_CONTEXT_MISMATCH');
      } catch (error) {
        // A legacy M5 order can lack an M16 record. Network, auth and mismatched
        // responses must remain visible errors rather than hiding pickup details.
        fulfillment = null;
        fulfillmentError = !(error instanceof Error && error.message === 'NOT_FOUND');
      }
      if (sequence !== this.readSequence || orderId !== this.data.id) return;
      if (consumerToken() !== session) {
        this.setData({ order: null, fulfillment: null, loading: false, error: true });
        return;
      }
      this.visibleSession = session;
      this.setData({ order, fulfillment, fulfillmentError, loading: false, error: false });
    } catch {
      if (sequence === this.readSequence && orderId === this.data.id)
        this.setData({ order: null, fulfillment: null, loading: false, error: true });
    }
  },

  async cancel() {
    if (this.cancelling || this.data.paying || this.data.order?.status !== 'UNPAID') return;
    if (!this.visibleSession || consumerToken() !== this.visibleSession) {
      this.setData({ order: null, fulfillment: null, error: true });
      return;
    }
    const session = this.visibleSession;
    this.cancelling = true;
    this.setData({ cancellingOrder: true, cancelMessage: '' });
    try {
      await cancelOrder(this.data.id);
      if (this.visibleSession === session && consumerToken() === session)
        this.setData({ cancelMessage: '取消请求已提交，请以最新订单状态为准。' });
    } catch {
      if (this.visibleSession === session && consumerToken() === session)
        this.setData({ cancelMessage: '取消结果未确认，请刷新订单后再操作。' });
    } finally {
      this.cancelling = false;
      this.setData({ cancellingOrder: false });
      if (this.visibleSession === session) {
        if (consumerToken() === session) await this.load();
        else {
          this.visibleSession = '';
          this.setData({ order: null, fulfillment: null, error: true });
        }
      }
    }
  },

  async pay() {
    if (this.data.paying || this.cancelling || this.data.order?.status !== 'UNPAID') return;
    if (!this.visibleSession || consumerToken() !== this.visibleSession) {
      this.setData({ order: null, fulfillment: null, error: true });
      return;
    }
    const session = this.visibleSession;
    this.setData({ paying: true, paymentMessage: '' });
    try {
      await payOrder(this.data.id);
      if (this.visibleSession === session && consumerToken() === session)
        this.setData({ paymentMessage: '支付结果以服务端订单状态为准，请刷新确认。' });
    } catch {
      if (this.visibleSession === session && consumerToken() === session)
        this.setData({ paymentMessage: '支付未完成或暂不可用。请刷新订单确认，勿重复付款。' });
    } finally {
      this.setData({ paying: false });
      if (this.visibleSession === session) {
        if (consumerToken() === session) await this.load();
        else {
          this.visibleSession = '';
          this.setData({ order: null, fulfillment: null, error: true });
        }
      }
    }
  },
});
