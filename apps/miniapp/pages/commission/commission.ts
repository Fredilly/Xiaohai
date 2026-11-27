import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import {
  createReferralLink,
  createWithdrawal,
  getCommissionAccount,
  listReferralLinks,
  listWithdrawals,
  type ReferralLink,
} from '../../services/commission';
import {
  canUseCommissionActions,
  commissionActionFailure,
  classifyCommissionError,
  type CommissionAccountStatus,
} from './commission-state';
import {
  clearPendingWithdrawal,
  persistPendingWithdrawal,
  readPendingWithdrawal,
  withdrawalAmountMinor,
} from './withdrawal-retry';

Page({
  readSequence: 0,
  accountUserId: '',
  accountSession: '',
  data: {
    loading: true,
    accountStatus: 'loading' as CommissionAccountStatus,
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
    pendingWithdrawal: false,
  },
  onShow() {
    // WeChat Page custom methods are typed dynamically by miniprogram-api-typings.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    void this.load();
  },
  onHide() {
    this.readSequence++;
    this.accountUserId = '';
    this.accountSession = '';
    this.setData({
      frozenMinor: 0,
      availableMinor: 0,
      entries: [],
      links: [],
      withdrawals: [],
      amountYuan: '',
      pendingWithdrawal: false,
    });
  },
  onUnload() {
    this.readSequence++;
    this.accountUserId = '';
    this.accountSession = '';
  },
  actionContextMatches(session: string, userId: string) {
    if (this.accountUserId !== userId || this.accountSession !== session) return false;
    if (consumerToken() === session && storedConsumerId() === userId) return true;
    // An operation started on the previously visible account must never leave
    // balances or a pending withdrawal form visible to a changed session.
    this.readSequence++;
    this.accountUserId = '';
    this.accountSession = '';
    this.setData({
      accountStatus: 'unauthenticated',
      error: '登录状态已变化，请重新进入佣金页面。',
      frozenMinor: 0,
      availableMinor: 0,
      entries: [],
      links: [],
      withdrawals: [],
      amountYuan: '',
      pendingWithdrawal: false,
    });
    return false;
  },
  async load() {
    const sequence = ++this.readSequence;
    const session = consumerToken();
    const userId = storedConsumerId();
    this.accountUserId = '';
    this.accountSession = '';
    this.setData({
      loading: true,
      accountStatus: 'loading',
      error: '',
      frozenMinor: 0,
      availableMinor: 0,
      entries: [],
      links: [],
      withdrawals: [],
      pendingWithdrawal: false,
    });
    if (!session || !userId) {
      this.setData({
        loading: false,
        accountStatus: 'unauthenticated',
        error: '请先登录后查看佣金信息。',
        amountYuan: '',
      });
      return;
    }
    try {
      const pending = readPendingWithdrawal(userId);
      const [account, links, withdrawals] = await Promise.all([
        getCommissionAccount(),
        listReferralLinks(),
        listWithdrawals(),
      ]);
      if (sequence !== this.readSequence) return;
      if (consumerToken() !== session || storedConsumerId() !== userId) {
        this.setData({
          loading: false,
          accountStatus: 'unauthenticated',
          error: '登录状态已变化，请重新进入佣金页面。',
        });
        return;
      }
      const resolved = Boolean(
        pending &&
        withdrawals.withdrawals.some(
          (item) =>
            item.clientRequestId === pending.clientRequestId &&
            item.amountMinor === pending.amountMinor,
        ),
      );
      if (pending && resolved) clearPendingWithdrawal(userId, pending.clientRequestId);
      this.accountUserId = userId;
      this.accountSession = session;
      this.setData({
        ...account,
        links: links.links,
        withdrawals: withdrawals.withdrawals,
        loading: false,
        accountStatus: 'ready',
        pendingWithdrawal: Boolean(pending && !resolved),
        ...(pending && !resolved ? { amountYuan: (pending.amountMinor / 100).toFixed(2) } : {}),
      });
    } catch (error) {
      if (sequence !== this.readSequence) return;
      if (consumerToken() !== session || storedConsumerId() !== userId) {
        this.setData({
          loading: false,
          accountStatus: 'unauthenticated',
          error: '登录状态已变化，请重新进入佣金页面。',
        });
        return;
      }
      const accountStatus = classifyCommissionError(error);
      this.setData({
        loading: false,
        accountStatus,
        error:
          accountStatus === 'unauthenticated'
            ? '请先登录后查看佣金信息。'
            : '佣金信息加载失败，请检查网络后重试。',
      });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
  async createLink() {
    if (this.data.busy || !canUseCommissionActions(this.data.accountStatus)) return;
    const userId = this.accountUserId as string;
    const session = this.accountSession as string;
    if (!userId || !session) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (!this.actionContextMatches(session, userId)) return;
    this.setData({ busy: true, error: '' });
    try {
      await createReferralLink('我的分享');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      if (this.actionContextMatches(session, userId)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await this.load();
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      if (this.actionContextMatches(session, userId))
        this.setData(commissionActionFailure(error, '分享链接创建失败。'));
    } finally {
      this.setData({ busy: false });
    }
  },
  amountInput(event: WechatMiniprogram.Input) {
    if (this.data.pendingWithdrawal) return;
    this.setData({ amountYuan: event.detail.value });
  },
  async withdraw() {
    if (!canUseCommissionActions(this.data.accountStatus)) return;
    const userId = this.accountUserId as string;
    const session = this.accountSession as string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (!userId || !session || !this.actionContextMatches(session, userId)) {
      this.setData({ error: '登录状态已变化，请重新进入佣金页面。' });
      return;
    }
    const amountMinor = withdrawalAmountMinor(this.data.amountYuan);
    if (amountMinor === null || this.data.busy)
      return this.setData({ error: '请输入有效提现金额。' });
    let pending;
    try {
      pending = readPendingWithdrawal(userId);
      if (pending && pending.amountMinor !== amountMinor) {
        this.setData({ error: '上次提现结果尚未确认，请按原金额重试或先查看提现记录。' });
        return;
      }
      if (!pending) {
        pending = {
          amountMinor,
          clientRequestId: `mini-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        };
        // Persist BEFORE POST. An unavailable/corrupt local store must fail closed.
        persistPendingWithdrawal(userId, pending);
      }
    } catch {
      this.setData({ error: '无法安全保存提现请求，请检查设备存储后再操作。' });
      return;
    }
    this.setData({ busy: true, pendingWithdrawal: true, error: '' });
    try {
      const result = await createWithdrawal(amountMinor, pending.clientRequestId);
      if (result.clientRequestId !== pending.clientRequestId || result.amountMinor !== amountMinor)
        throw new Error('WITHDRAWAL_RESPONSE_MISMATCH');
      clearPendingWithdrawal(userId, pending.clientRequestId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      if (!this.actionContextMatches(session, userId)) return;
      this.setData({ amountYuan: '', pendingWithdrawal: false });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.load();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      if (this.actionContextMatches(session, userId)) {
        this.setData(
          commissionActionFailure(
            error,
            '提现结果未确认，请先查看提现记录；原金额重试会复用同一请求。',
          ),
        );
      }
    } finally {
      this.setData({ busy: false });
    }
  },
  copyLink(event: WechatMiniprogram.TouchEvent) {
    if (
      !canUseCommissionActions(this.data.accountStatus) ||
      !this.accountUserId ||
      !this.accountSession ||
      consumerToken() !== this.accountSession ||
      storedConsumerId() !== this.accountUserId
    )
      return;
    const code = String(event.currentTarget.dataset.code || '');
    if (code) void wx.setClipboardData({ data: code });
  },
  onShareAppMessage(event: WechatMiniprogram.Page.IShareAppMessageOption) {
    if (
      !canUseCommissionActions(this.data.accountStatus) ||
      !this.accountUserId ||
      !this.accountSession ||
      consumerToken() !== this.accountSession ||
      storedConsumerId() !== this.accountUserId
    ) {
      return { title: '来小海童话发现好书', path: '/pages/index/index' };
    }
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
