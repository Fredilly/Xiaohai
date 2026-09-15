import { listSeries } from '../../services/content';
Page({
  data: {
    q: '',
    category: '',
    series: [] as Awaited<ReturnType<typeof listSeries>>['series'],
    loading: false,
    error: '',
  },
  onLoad() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await listSeries(this.data.q, this.data.category);
      this.setData({ series: r.series });
    } catch {
      this.setData({ error: '内容加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },
  onQuery(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value });
  },
  search() {
    void this.load();
  },
  open(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/story-detail/story-detail?id=${String(e.currentTarget.dataset.id)}`,
    });
  },
});
