import type { FulfillmentMethod, FulfillmentQuote } from '@xiaohai/contracts/fulfillment';
import type { PublicStore } from '@xiaohai/contracts/stores';
import { listAddresses, type Address } from '../../services/commerce';
import {
  createFulfillmentOrder,
  quoteFulfillment,
  randomClientRequestId,
} from '../../services/fulfillment';
import { listStores } from '../../services/stores';
import { consumerToken } from '../../services/consumer-session';

type PickerEvent = { detail: { value: string } };
type MethodEvent = { currentTarget: { dataset: { method?: FulfillmentMethod } } };
type SubmittedCheckout = {
  method: FulfillmentMethod;
  storeId: string;
  addressId: string;
  totalMinor: number;
};

function matchingQuote(quote: FulfillmentQuote, method: FulfillmentMethod, storeId: string) {
  return (
    quote.method === method &&
    quote.store?.id === storeId &&
    Number.isSafeInteger(quote.subtotalMinor) &&
    quote.subtotalMinor >= 0 &&
    Number.isSafeInteger(quote.deliveryFeeMinor) &&
    quote.deliveryFeeMinor >= 0 &&
    Number.isSafeInteger(quote.totalMinor) &&
    quote.totalMinor === quote.subtotalMinor + quote.deliveryFeeMinor
  );
}

Page({
  quoteSequence: 0,
  loadSequence: 0,
  loadedSession: '',
  orderAttemptSession: '',
  attemptedContext: null as SubmittedCheckout | null,
  reloadOnShow: false,
  wasHidden: false,
  pageClosed: false,
  navigating: false,
  data: {
    addresses: [] as Address[],
    stores: [] as PublicStore[],
    addressIndex: 0,
    storeIndex: 0,
    addressId: '',
    storeId: '',
    method: 'PICKUP',
    quote: null as FulfillmentQuote | null,
    clientRequestId: '',
    loading: true,
    quoting: false,
    creating: false,
    orderAttempted: false,
    createdOrderId: '',
    needsLogin: false,
    errorMessage: '',
  },

  onLoad() {
    this.setData({ clientRequestId: randomClientRequestId() });
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.loadSequence++;
    this.quoteSequence++;
    this.loadedSession = '';
    this.reloadOnShow = true;
    this.setData({ addresses: [], stores: [], quote: null, quoting: false });
  },
  onShow() {
    if (this.pageClosed) return;
    this.wasHidden = false;
    if (this.data.createdOrderId) {
      if (this.orderAttemptSession !== consumerToken()) {
        this.setData({
          addresses: [],
          stores: [],
          quote: null,
          createdOrderId: '',
          errorMessage: '登录账号已切换，请先核对原账号的订单。',
        });
        return;
      }
      this.openCreatedOrder();
      return;
    }
    if (this.reloadOnShow) {
      this.reloadOnShow = false;
      void this.load();
    }
  },
  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.loadSequence++;
    this.quoteSequence++;
    this.loadedSession = '';
    this.setData({ addresses: [], stores: [], quote: null, createdOrderId: '' });
  },

  async load() {
    if (this.wasHidden || this.pageClosed) return;
    const sequence = ++this.loadSequence;
    const session = consumerToken();
    this.quoteSequence++;
    this.loadedSession = '';
    this.setData({
      addresses: [],
      stores: [],
      quote: null,
      loading: true,
      quoting: false,
      needsLogin: false,
      errorMessage: '',
    });
    if (!session) {
      this.setData({
        loading: false,
        needsLogin: true,
        errorMessage: '请先微信登录，再确认订单。',
      });
      return;
    }
    if (this.data.orderAttempted && this.orderAttemptSession !== session) {
      this.setData({
        loading: false,
        createdOrderId: '',
        errorMessage: '登录账号已切换，请先核对原账号的订单，再重新进入结算。',
      });
      return;
    }
    try {
      const [addresses, stores] = await Promise.all([listAddresses(), listStores({ limit: 50 })]);
      if (sequence !== this.loadSequence || this.wasHidden || this.pageClosed) return;
      if (consumerToken() !== session) {
        this.setData({ loading: false, errorMessage: '登录状态已变化，请重新进入结算。' });
        return;
      }
      this.loadedSession = session;
      const selectedAddressIndex = Math.max(
        0,
        addresses.addresses.findIndex((item) =>
          this.data.orderAttempted ? item.id === this.data.addressId : item.isDefault,
        ),
      );
      const selectedStoreIndex = this.data.orderAttempted
        ? stores.findIndex((item) => item.id === this.data.storeId)
        : 0;
      this.setData({
        addresses: addresses.addresses,
        stores,
        addressIndex: selectedAddressIndex,
        addressId: addresses.addresses[selectedAddressIndex]?.id ?? '',
        storeIndex: Math.max(0, selectedStoreIndex),
        storeId: selectedStoreIndex < 0 ? '' : (stores[selectedStoreIndex]?.id ?? ''),
        loading: false,
      });
      await this.preview();
      if (
        sequence === this.loadSequence &&
        !this.wasHidden &&
        !this.pageClosed &&
        this.data.orderAttempted &&
        !this.data.createdOrderId &&
        consumerToken() === session
      )
        this.setData({
          errorMessage: '订单结果未确认，请先核对我的订单；如需重试必须使用原请求。',
        });
    } catch {
      if (sequence === this.loadSequence && !this.wasHidden && !this.pageClosed)
        this.setData({ loading: false, errorMessage: '结算信息加载失败，请检查登录和网络。' });
    }
  },

  chooseMethod(event: MethodEvent) {
    if (this.wasHidden || this.pageClosed || this.data.creating || this.data.orderAttempted) return;
    const method = event.currentTarget.dataset.method;
    if (!method || method === this.data.method) return;
    this.setData({ method, quote: null, errorMessage: '' });
    void this.preview();
  },

  chooseStore(event: PickerEvent) {
    if (this.wasHidden || this.pageClosed || this.data.creating || this.data.orderAttempted) return;
    const storeIndex = Number(event.detail.value);
    const storeId = this.data.stores[storeIndex]?.id ?? '';
    this.setData({ storeIndex, storeId, quote: null, errorMessage: '' });
    void this.preview();
  },

  chooseAddress(event: PickerEvent) {
    if (this.wasHidden || this.pageClosed || this.data.creating || this.data.orderAttempted) return;
    const addressIndex = Number(event.detail.value);
    const addressId = this.data.addresses[addressIndex]?.id ?? '';
    this.setData({ addressIndex, addressId, quote: null, errorMessage: '' });
    void this.preview();
  },

  async preview() {
    if (this.wasHidden || this.pageClosed) return;
    const quoteSequence = ++this.quoteSequence;
    const session = consumerToken();
    if (!session || session !== this.loadedSession) {
      this.setData({
        addresses: [],
        quote: null,
        quoting: false,
        errorMessage: '登录状态已变化，请重新进入结算。',
      });
      return;
    }
    const method = this.data.method === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    const storeId = this.data.storeId;
    const addressId = this.data.addressId;
    if (!storeId || (method === 'DELIVERY' && !addressId)) {
      this.setData({
        quote: null,
        quoting: false,
        errorMessage: !storeId
          ? '当前没有可用的履约门店，请重新加载或先核对已有订单。'
          : '请先添加配送地址，或改为到店自提。',
      });
      return;
    }
    this.setData({ quoting: true, errorMessage: '' });
    try {
      const quote = await quoteFulfillment(
        method,
        storeId,
        method === 'DELIVERY' ? addressId : undefined,
      );
      if (quoteSequence !== this.quoteSequence || this.wasHidden || this.pageClosed) return;
      if (consumerToken() !== session) throw new Error('SESSION_CHANGED');
      if (!matchingQuote(quote, method, storeId)) {
        throw new Error('QUOTE_CONTEXT_MISMATCH');
      }
      this.setData({ quote });
    } catch (error) {
      if (quoteSequence !== this.quoteSequence || this.wasHidden || this.pageClosed) return;
      this.setData({
        ...(consumerToken() !== session ? { addresses: [] } : {}),
        quote: null,
        errorMessage:
          consumerToken() !== session
            ? '登录状态已变化，请重新进入结算。'
            : error instanceof Error && error.message === 'DELIVERY_UNAVAILABLE'
              ? '该门店暂不支持所选地址的同城配送，请改为到店自提或选择其他门店。'
              : '当前无法计算履约方式，请稍后重试。',
      });
    } finally {
      if (quoteSequence === this.quoteSequence && !this.wasHidden && !this.pageClosed)
        this.setData({ quoting: false });
    }
  },

  async create() {
    if (
      this.wasHidden ||
      this.pageClosed ||
      this.data.creating ||
      this.data.quoting ||
      !this.data.quote ||
      !this.data.clientRequestId
    )
      return;
    const session = consumerToken();
    if (!session || session !== this.loadedSession) {
      this.setData({
        addresses: [],
        quote: null,
        errorMessage: '登录状态已变化，请重新进入结算。',
      });
      return;
    }
    if (this.data.orderAttempted && this.orderAttemptSession !== session) {
      this.setData({
        addresses: [],
        quote: null,
        createdOrderId: '',
        errorMessage: '登录账号已切换，请先核对原账号的订单。',
      });
      return;
    }
    if (this.data.createdOrderId) return;
    const method = this.data.method === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    if (!matchingQuote(this.data.quote, method, this.data.storeId)) {
      this.setData({ quote: null, errorMessage: '门店或报价已变化，请重新获取金额。' });
      return;
    }
    const context: SubmittedCheckout = {
      method,
      storeId: this.data.storeId,
      addressId: method === 'DELIVERY' ? this.data.addressId : '',
      totalMinor: this.data.quote.totalMinor,
    };
    if (this.data.orderAttempted) {
      if (
        !this.attemptedContext ||
        this.attemptedContext.method !== context.method ||
        this.attemptedContext.storeId !== context.storeId ||
        this.attemptedContext.addressId !== context.addressId ||
        this.attemptedContext.totalMinor !== context.totalMinor
      ) {
        this.setData({
          quote: null,
          errorMessage: '原订单请求的金额或履约信息已变化，请先核对我的订单。',
        });
        return;
      }
    } else {
      this.attemptedContext = context;
    }
    this.orderAttemptSession = session;
    this.setData({ creating: true, orderAttempted: true, errorMessage: '' });
    try {
      const result = await createFulfillmentOrder(
        context.method,
        context.storeId,
        this.data.clientRequestId,
        context.method === 'DELIVERY' ? context.addressId : undefined,
        context.totalMinor,
      );
      if (this.pageClosed) return;
      if (consumerToken() !== session) {
        this.setData({
          addresses: [],
          quote: null,
          errorMessage: '登录状态已变化，请核对我的订单。',
        });
        return;
      }
      this.setData({ createdOrderId: result.orderId });
      if (!this.wasHidden) this.openCreatedOrder();
    } catch {
      if (this.pageClosed) return;
      if (consumerToken() !== session) {
        this.setData({
          addresses: [],
          quote: null,
          errorMessage: '登录状态已变化，请先核对原账号的订单。',
        });
      } else {
        this.setData({
          errorMessage: '订单结果未确认，请先核对我的订单；可使用原请求重试，勿重复创建。',
        });
      }
    } finally {
      if (!this.pageClosed) this.setData({ creating: false });
    }
  },
  openCreatedOrder() {
    if (
      this.wasHidden ||
      this.pageClosed ||
      this.navigating ||
      !this.data.createdOrderId ||
      !this.orderAttemptSession ||
      this.orderAttemptSession !== consumerToken()
    )
      return;
    this.navigating = true;
    void wx.redirectTo({
      url: `/pages/order-detail/order-detail?id=${encodeURIComponent(this.data.createdOrderId)}`,
      fail: () => {
        this.navigating = false;
      },
    });
  },
  openOrders() {
    if (this.pageClosed) return;
    void wx.navigateTo({ url: '/pages/orders/orders' });
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
});
