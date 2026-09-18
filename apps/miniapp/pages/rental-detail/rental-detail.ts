import type { RentalView } from '@xiaohai/contracts/rental';
import { cancelRental, getRental } from '../../services/rental';
const label: Record<string, string> = {
  RESERVED: '已预约',
  BORROWED: '借阅中',
  OVERDUE: '已逾期',
  RETURNED: '已归还',
  CANCELLED: '已取消',
};
Page({
  data: {
    id: '',
    loading: false,
    busy: false,
    error: '',
    rental: null as (RentalView & { statusText: string; dueText: string }) | null,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
    void this.load();
  },
  async load() {
    if (!this.data.id) return;
    this.setData({ loading: true, error: '' });
    try {
      const item = await getRental(this.data.id);
      this.setData({
        rental: {
          ...item,
          statusText: label[item.status] ?? item.status,
          dueText: item.dueAt ? new Date(item.dueAt).toLocaleString() : '门店借出时由服务端确定',
        },
      });
    } catch {
      this.setData({ error: '租借记录不存在或无法访问' });
    } finally {
      this.setData({ loading: false });
    }
  },
  async cancel() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await cancelRental(this.data.id);
      await this.load();
    } catch {
      this.setData({ error: '仅已预约记录可取消，请刷新后重试' });
    } finally {
      this.setData({ busy: false });
    }
  },
});
