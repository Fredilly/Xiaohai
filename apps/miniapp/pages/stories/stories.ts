import { listSeries } from '../../services/content';
Page({
  requestVersion: 0,
  wasHidden: false,
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
  onShow() {
    if (!this.wasHidden) return;
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.requestVersion++;
    this.setData({ loading: false });
  },
  onUnload() {
    this.wasHidden = true;
    this.requestVersion++;
  },
  async load() {
    const version = ++this.requestVersion;
    const { q, category } = this.data;
    this.setData({ loading: true, error: '', series: [] });
    try {
      const r = await listSeries(q, category);
      if (this.wasHidden || version !== this.requestVersion) return;
      this.setData({ series: r.series });
    } catch {
      if (this.wasHidden || version !== this.requestVersion) return;
      this.setData({ error: '内容加载失败，请稍后重试' });
    } finally {
      if (!this.wasHidden && version === this.requestVersion) this.setData({ loading: false });
    }
  },
  onQuery(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value });
  },
  search() {
    void this.load();
  },
  open(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    if (id)
      void wx.navigateTo({ url: `/pages/story-detail/story-detail?id=${encodeURIComponent(id)}` });
  },
});
