import type { RentalView } from '@xiaohai/contracts/rental';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { listRentals } from '../../services/rental';
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
  data: {
    loading: false,
    error: '',
    needsLogin: false,
    items: [] as Array<RentalView & { statusText: string; dueText: string }>,
  },
  onShow() {
    void this.load();
  },
  onHide() {
    this.readSequence++;
    this.visibleSession = '';
    this.setData({ items: [] });
  },
  onUnload() {
    this.readSequence++;
    this.visibleSession = '';
  },
  async load() {
    const sequence = ++this.readSequence;
    const session = consumerToken();
    const userId = storedConsumerId();
    this.visibleSession = '';
    this.setData({ loading: true, error: '', items: [], needsLogin: false });
    if (!session || !userId) {
      this.setData({ loading: false, needsLogin: true, error: '请先登录后查看租借记录' });
      return;
    }
    const acceptResponse = () => {
      if (sequence !== this.readSequence) return false;
      const currentSession = consumerToken();
      const currentUserId = storedConsumerId();
      if (currentSession !== session || currentUserId !== userId) {
        this.setData({ items: [], loading: false, needsLogin: !currentSession, error: '' });
        if (currentSession && currentUserId) void this.load();
        return false;
      }
      return true;
    };
    try {
      const result = await listRentals();
      if (!acceptResponse()) return;
      if (result.items.some((item) => item.consumerUserId !== userId))
        throw new Error('RENTAL_OWNER_MISMATCH');
      this.visibleSession = session;
      this.setData({
        items: result.items.map((item) => ({
          ...item,
          statusText: label[item.status] ?? item.status,
          dueText: item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '借出时确定',
        })),
      });
    } catch (e) {
      if (!acceptResponse()) return;
      const needsLogin =
        e instanceof Error && (e.message === 'AUTH_REQUIRED' || e.message === 'HTTP_401');
      this.setData({
        items: [],
        needsLogin,
        error: needsLogin ? '请先在“我的”登录' : '加载失败，请稍后重试',
      });
    } finally {
      if (sequence === this.readSequence) this.setData({ loading: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (
      id &&
      this.visibleSession === consumerToken() &&
      this.data.items.some((item) => item.id === id)
    )
      void wx.navigateTo({
        url: `/pages/rental-detail/rental-detail?id=${encodeURIComponent(id)}`,
      });
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
});
