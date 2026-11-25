import type { RentalView } from '@xiaohai/contracts/rental';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { cancelRental, getRental, randomId } from '../../services/rental';
import {
  clearCancellationKey,
  pendingCancellationKey,
  persistCancellationKey,
} from '../../services/rental-retry';
import { detailAccessMessage } from '../../utils/detail-read-error';
const label: Record<string, string> = {
  RESERVED: '已预约',
  BORROWED: '借阅中',
  OVERDUE: '已逾期',
  RETURNED: '已归还',
  CANCELLED: '已取消',
};
Page({
  readSequence: 0,
  visibleSession: '',
  visibleUserId: '',
  data: {
    id: '',
    loading: false,
    busy: false,
    error: '',
    accessMessage: '',
    needsLogin: false,
    rental: null as (RentalView & { statusText: string; dueText: string }) | null,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
  },
  onShow() {
    if (this.data.id) void this.load();
  },
  onHide() {
    this.readSequence++;
    this.visibleSession = '';
    this.visibleUserId = '';
    this.setData({ rental: null });
  },
  onUnload() {
    this.readSequence++;
    this.visibleSession = '';
    this.visibleUserId = '';
  },
  async load() {
    if (!this.data.id) return;
    const sequence = ++this.readSequence;
    const session = consumerToken();
    const userId = storedConsumerId();
    const rentalId = this.data.id;
    this.visibleSession = '';
    this.visibleUserId = '';
    this.setData({
      loading: true,
      error: '',
      accessMessage: '',
      rental: null,
      needsLogin: false,
    });
    if (!session || !userId) {
      this.setData({ loading: false, needsLogin: true, error: '登录后查看租借记录' });
      return;
    }
    const acceptResponse = () => {
      if (sequence !== this.readSequence || rentalId !== this.data.id) return false;
      const currentSession = consumerToken();
      const currentUser = storedConsumerId();
      if (currentSession !== session || currentUser !== userId) {
        this.setData({ rental: null, loading: false, needsLogin: !currentSession, error: '' });
        if (currentSession && currentUser) void this.load();
        return false;
      }
      return true;
    };
    try {
      const item = await getRental(rentalId);
      if (!acceptResponse()) return;
      if (item.id !== rentalId || item.consumerUserId !== userId)
        throw new Error('RENTAL_CONTEXT_MISMATCH');
      if (item.status === 'CANCELLED') {
        const pending = pendingCancellationKey(userId, rentalId);
        if (pending) clearCancellationKey(userId, rentalId, pending);
      }
      this.visibleSession = session;
      this.visibleUserId = userId;
      this.setData({
        rental: {
          ...item,
          statusText: label[item.status] ?? item.status,
          dueText: item.dueAt ? new Date(item.dueAt).toLocaleString() : '门店借出时由服务端确定',
        },
      });
    } catch (error) {
      if (!acceptResponse()) return;
      this.setData({
        error: '租借记录不存在或无法访问',
        accessMessage: detailAccessMessage(error),
        rental: null,
      });
    } finally {
      if (sequence === this.readSequence) this.setData({ loading: false });
    }
  },
  retry() {
    if (this.data.error && !this.data.loading && !this.data.accessMessage) {
      void this.load();
    }
  },
  async cancel() {
    if (this.data.busy || this.data.rental?.status !== 'RESERVED') return;
    const session = consumerToken();
    const userId = storedConsumerId();
    const rentalId = this.data.id;
    if (!session || session !== this.visibleSession || userId !== this.visibleUserId) {
      this.setData({ rental: null, error: '登录状态已变化，请重新读取租借记录。' });
      return;
    }
    let key: string;
    try {
      key = pendingCancellationKey(userId, rentalId) ?? randomId();
      persistCancellationKey(userId, rentalId, key);
    } catch {
      this.setData({ error: '无法安全保存取消请求，请检查设备存储后重试。' });
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await cancelRental(rentalId, key);
      if (
        result.id !== rentalId ||
        result.consumerUserId !== userId ||
        result.status !== 'CANCELLED'
      )
        throw new Error('RENTAL_CANCEL_CONTEXT_MISMATCH');
      clearCancellationKey(userId, rentalId, key);
      if (
        consumerToken() === session &&
        storedConsumerId() === userId &&
        this.visibleSession === session &&
        this.visibleUserId === userId
      )
        await this.load();
    } catch {
      if (consumerToken() === session && storedConsumerId() === userId)
        this.setData({ error: '取消结果未确认，请刷新记录；再次提交会沿用原请求。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
});
