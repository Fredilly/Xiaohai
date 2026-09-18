import type { RentalView } from '@xiaohai/contracts/rental';
import { listRentals } from '../../services/rental';
const label: Record<string, string> = {
  RESERVED: '已预约',
  BORROWED: '借阅中',
  OVERDUE: '已逾期',
  RETURNED: '已归还',
  CANCELLED: '已取消',
};
Page({
  data: {
    loading: false,
    error: '',
    items: [] as Array<RentalView & { statusText: string; dueText: string }>,
  },
  onShow() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await listRentals();
      this.setData({
        items: result.items.map((item) => ({
          ...item,
          statusText: label[item.status] ?? item.status,
          dueText: item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '借出时确定',
        })),
      });
    } catch (e) {
      this.setData({
        error:
          e instanceof Error && e.message === 'AUTH_REQUIRED'
            ? '请先在“我的”登录'
            : '加载失败，请稍后重试',
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) void wx.navigateTo({ url: `/pages/rental-detail/rental-detail?id=${id}` });
  },
});
