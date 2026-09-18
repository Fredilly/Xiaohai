import type { FulfillmentMethod, FulfillmentQuote } from '@xiaohai/contracts/fulfillment';
import type { PublicStore } from '@xiaohai/contracts/stores';
import { listAddresses, type Address } from '../../services/commerce';
import {
  createFulfillmentOrder,
  quoteFulfillment,
  randomClientRequestId,
} from '../../services/fulfillment';
import { listStores } from '../../services/stores';

type PickerEvent = { detail: { value: string } };
type MethodEvent = { currentTarget: { dataset: { method?: FulfillmentMethod } } };

Page({
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
    errorMessage: '',
  },

  onLoad() {
    this.setData({ clientRequestId: randomClientRequestId() });
    void this.load();
  },

  async load() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const [addresses, stores] = await Promise.all([listAddresses(), listStores({ limit: 50 })]);
      const selectedAddressIndex = Math.max(
        0,
        addresses.addresses.findIndex((item) => item.isDefault),
      );
      this.setData({
        addresses: addresses.addresses,
        stores,
        addressIndex: selectedAddressIndex,
        addressId: addresses.addresses[selectedAddressIndex]?.id ?? '',
        storeIndex: 0,
        storeId: stores[0]?.id ?? '',
        loading: false,
      });
      await this.preview();
    } catch {
      this.setData({ loading: false, errorMessage: '结算信息加载失败，请检查登录和网络。' });
    }
  },

  chooseMethod(event: MethodEvent) {
    const method = event.currentTarget.dataset.method;
    if (!method || method === this.data.method) return;
    this.setData({ method, quote: null, errorMessage: '' });
    void this.preview();
  },

  chooseStore(event: PickerEvent) {
    const storeIndex = Number(event.detail.value);
    const storeId = this.data.stores[storeIndex]?.id ?? '';
    this.setData({ storeIndex, storeId, quote: null, errorMessage: '' });
    void this.preview();
  },

  chooseAddress(event: PickerEvent) {
    const addressIndex = Number(event.detail.value);
    const addressId = this.data.addresses[addressIndex]?.id ?? '';
    this.setData({ addressIndex, addressId, quote: null, errorMessage: '' });
    void this.preview();
  },

  async preview() {
    const method = this.data.method === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    if (!this.data.storeId) return;
    if (method === 'DELIVERY' && !this.data.addressId) return;
    this.setData({ quoting: true, errorMessage: '' });
    try {
      const quote = await quoteFulfillment(
        method,
        this.data.storeId,
        method === 'DELIVERY' ? this.data.addressId : undefined,
      );
      this.setData({ quote });
    } catch (error) {
      this.setData({
        quote: null,
        errorMessage:
          error instanceof Error && error.message === 'DELIVERY_UNAVAILABLE'
            ? '该门店暂不支持所选地址的同城配送，请改为到店自提或选择其他门店。'
            : '当前无法计算履约方式，请稍后重试。',
      });
    } finally {
      this.setData({ quoting: false });
    }
  },

  async create() {
    if (this.data.creating || !this.data.quote || !this.data.clientRequestId) return;
    const method = this.data.method === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    this.setData({ creating: true, errorMessage: '' });
    try {
      const result = await createFulfillmentOrder(
        method,
        this.data.storeId,
        this.data.clientRequestId,
        method === 'DELIVERY' ? this.data.addressId : undefined,
      );
      void wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${result.orderId}` });
    } catch {
      this.setData({ errorMessage: '创建订单失败，请不要重复点击，可稍后重试。' });
    } finally {
      this.setData({ creating: false });
    }
  },
});
