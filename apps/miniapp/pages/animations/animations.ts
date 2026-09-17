import type { Animation } from '@xiaohai/contracts/animation';
import { listAnimations } from '../../services/animation';

Page({
  data: { loading: true, error: '', animations: [] as Animation[] },
  onShow() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      this.setData({ animations: (await listAnimations()).animations });
    } catch {
      this.setData({ error: '动画作品加载失败，请检查登录状态和网络。' });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) void wx.navigateTo({ url: `/pages/animation-detail/animation-detail?id=${id}` });
  },
});
