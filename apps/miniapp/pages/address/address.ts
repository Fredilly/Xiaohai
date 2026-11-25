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
  readSequence: 0,
  visibleSession: '',
  mutationInFlight: false,
  data: {
    addresses: [] as Address[],
    loading: true,
    error: false,
    needsLogin: false,
    mutating: false,
  },
  onShow() {
    void this.load();
  },
  onHide() {
    this.readSequence++;
    this.visibleSession = '';
    this.setData({ addresses: [] });
  },
  onUnload() {
    this.readSequence++;
    this.visibleSession = '';
  },
  async load() {
    const sequence = ++this.readSequence;
    const session = consumerToken();
    this.visibleSession = '';
    if (!session) {
      this.setData({ addresses: [], loading: false, error: false, needsLogin: true });
      return;
    }
    this.setData({ addresses: [], loading: true, error: false, needsLogin: false });
    const acceptResponse = () => {
      if (sequence !== this.readSequence) return false;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ addresses: [], loading: false, error: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return false;
      }
      return true;
    };
    try {
      const result = await listAddresses();
      if (!acceptResponse()) return;
      this.visibleSession = session;
      this.setData({
        addresses: result.addresses,
        loading: false,
        error: false,
        needsLogin: false,
      });
    } catch (error) {
      if (!acceptResponse()) return;
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
  async mutate(action: (session: string) => Promise<boolean>) {
    const session = consumerToken();
    if (this.mutationInFlight) return;
    if (!session || session !== this.visibleSession) {
      this.setData({ addresses: [], error: Boolean(session), needsLogin: !session });
      return;
    }
    this.mutationInFlight = true;
    this.readSequence++;
    this.setData({ mutating: true, error: false });
    try {
      const changed = await action(session);
      if (consumerToken() !== session || this.visibleSession !== session) {
        this.setData({
          addresses: [],
          needsLogin: !consumerToken(),
          error: Boolean(consumerToken()),
        });
        return;
      }
      if (changed) await this.load();
    } catch {
      if (consumerToken() === session) this.setData({ error: true });
      else
        this.setData({
          addresses: [],
          needsLogin: !consumerToken(),
          error: Boolean(consumerToken()),
        });
    } finally {
      this.mutationInFlight = false;
      this.setData({ mutating: false });
    }
  },
  async add() {
    await this.mutate(async (session) => {
      const input = await collect(
        undefined,
        () => consumerToken() === session && this.visibleSession === session,
      );
      if (!input || consumerToken() !== session || this.visibleSession !== session) return false;
      await createAddress({ ...input, isDefault: this.data.addresses.length === 0 });
      return true;
    });
  },
  async edit(e: WechatMiniprogram.TouchEvent) {
    const current = this.data.addresses.find((a) => a.id === e.currentTarget.dataset.id);
    if (!current) return;
    await this.mutate(async (session) => {
      const input = await collect(
        current,
        () => consumerToken() === session && this.visibleSession === session,
      );
      if (!input || consumerToken() !== session || this.visibleSession !== session) return false;
      await updateAddress(current.id, input);
      return true;
    });
  },
  async remove(e: WechatMiniprogram.TouchEvent) {
    await this.mutate(async () => {
      await deleteAddress(String(e.currentTarget.dataset.id));
      return true;
    });
  },
  async makeDefault(e: WechatMiniprogram.TouchEvent) {
    const current = this.data.addresses.find((a) => a.id === e.currentTarget.dataset.id);
    if (!current) return;
    await this.mutate(async () => {
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
      return true;
    });
  },
});
async function collect(current?: Address, isCurrent = () => true): Promise<AddressInput | null> {
  const recipientName = await field('收件人', current?.recipientName);
  if (!recipientName || !isCurrent()) return null;
  const phone = await field('手机号', current?.phone);
  if (!phone || !isCurrent()) return null;
  const region = await field('省/地区', current?.region);
  if (!region || !isCurrent()) return null;
  const city = await field('城市', current?.city);
  if (!city || !isCurrent()) return null;
  const district = await field('区县', current?.district);
  if (!district || !isCurrent()) return null;
  const addressLine = await field('详细地址', current?.addressLine);
  if (!addressLine || !isCurrent()) return null;
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
