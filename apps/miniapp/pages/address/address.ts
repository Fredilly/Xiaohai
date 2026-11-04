import { consumerToken } from '../../services/consumer-session';
import {
  CommerceApiError,
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  type Address,
  type AddressInput,
} from '../../services/commerce';
Page({
  data: { addresses: [] as Address[], loading: true, error: false, needsLogin: false },
  onShow() {
    void this.load();
  },
  async load() {
    if (!consumerToken()) {
      this.setData({ addresses: [], loading: false, error: false, needsLogin: true });
      return;
    }
    this.setData({ loading: true, error: false, needsLogin: false });
    try {
      this.setData({
        addresses: (await listAddresses()).addresses,
        loading: false,
        error: false,
        needsLogin: false,
      });
    } catch (error) {
      const needsLogin = error instanceof CommerceApiError && error.status === 401;
      this.setData({
        addresses: [],
        loading: false,
        error: !needsLogin,
        needsLogin,
      });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
  async add() {
    if (!consumerToken()) return;
    const input = await collect();
    if (!input) return;
    await createAddress({ ...input, isDefault: this.data.addresses.length === 0 });
    void this.load();
  },
  async edit(e: WechatMiniprogram.TouchEvent) {
    if (!consumerToken()) return;
    const current = this.data.addresses.find((a) => a.id === e.currentTarget.dataset.id);
    if (!current) return;
    const input = await collect(current);
    if (!input) return;
    await updateAddress(current.id, input);
    void this.load();
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    if (!consumerToken()) return;
    await deleteAddress(String(e.currentTarget.dataset.id));
    void this.load();
  },
  async makeDefault(e: WechatMiniprogram.TouchEvent) {
    if (!consumerToken()) return;
    const current = this.data.addresses.find((a) => a.id === e.currentTarget.dataset.id);
    if (!current) return;
    await updateAddress(current.id, {
      recipientName: current.recipientName,
      phone: current.phone,
      region: current.region,
      city: current.city,
      district: current.district,
      addressLine: current.addressLine,
      postalCode: current.postalCode ?? null,
      isDefault: true,
    });
    void this.load();
  },
});
async function collect(current?: Address): Promise<AddressInput | null> {
  const recipientName = await field('收件人', current?.recipientName);
  if (!recipientName) return null;
  const phone = await field('手机号', current?.phone);
  if (!phone) return null;
  const region = await field('省/地区', current?.region);
  if (!region) return null;
  const city = await field('城市', current?.city);
  if (!city) return null;
  const district = await field('区县', current?.district);
  if (!district) return null;
  const addressLine = await field('详细地址', current?.addressLine);
  if (!addressLine) return null;
  return {
    recipientName,
    phone,
    region,
    city,
    district,
    addressLine,
    postalCode: current?.postalCode ?? null,
    isDefault: current?.isDefault ?? false,
  };
}
function field(title: string, content = ''): Promise<string> {
  return new Promise((resolve) =>
    wx.showModal({
      title,
      content,
      editable: true,
      success: (r) => resolve(r.confirm ? r.content?.trim() || '' : ''),
    }),
  );
}
