import {
  createReferralLink,
  createWithdrawal,
  getCommissionAccount,
  listReferralLinks,
  listWithdrawals,
  type ReferralLink,
} from '../../services/commission';

Page({
  data: {
    loading: true,
    busy: false,
    error: '',
    frozenMinor: 0,
    availableMinor: 0,
    entries: [] as Array<{ id: string; eventType: string; amountMinor: number; createdAt: string }>,
    links: [] as ReferralLink[],
    withdrawals: [] as Array<{
      id: string;
      amountMinor: number;
      status: string;
      createdAt: string;
    }>,
    amountYuan: '',
  },
  onShow() {
    // WeChat Page custom methods are typed dynamically by miniprogram-api-typings.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [account, links, withdrawals] = await Promise.all([
        getCommissionAccount(),
        listReferralLinks(),
        listWithdrawals(),
      ]);
      this.setData({
        ...account,
        links: links.links,
        withdrawals: withdrawals.withdrawals,
        loading: false,
      });
    } catch {
      this.setData({ loading: false, error: '佣金信息加载失败，请确认已登录。' });
    }
  },
  async createLink() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await createReferralLink('我的分享');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.load();
    } catch {
      this.setData({ error: '分享链接创建失败。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  amountInput(event: WechatMiniprogram.Input) {
    this.setData({ amountYuan: event.detail.value });
  },
  async withdraw() {
    const amountMinor = Math.round(Number(this.data.amountYuan) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || this.data.busy)
      return this.setData({ error: '请输入有效提现金额。' });
    this.setData({ busy: true, error: '' });
    try {
      await createWithdrawal(
        amountMinor,
        `mini-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      this.setData({ amountYuan: '' });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.load();
    } catch {
      this.setData({ error: '提现申请失败，请检查可用余额或稍后重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  copyLink(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code || '');
    if (code) void wx.setClipboardData({ data: code });
  },
  onShareAppMessage(event: WechatMiniprogram.Page.IShareAppMessageOption) {
    const code = String(
      (event.target as { dataset?: { code?: string } } | undefined)?.dataset?.code ??
        this.data.links[0]?.code ??
        '',
    );
    return {
      title: '来小海童话发现好书',
      path: `/pages/referral/referral?code=${encodeURIComponent(code)}`,
    };
  },
});
