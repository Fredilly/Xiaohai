import { listSeries } from '../../services/content';
Page({
  requestVersion: 0,
  wasHidden: false,
  pageClosed: false,
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
    if (this.pageClosed) return;
    if (!this.wasHidden) return;
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.requestVersion++;
    this.setData({ series: [], loading: false });
  },
  onUnload() {
    this.pageClosed = true;
    this.wasHidden = true;
    this.requestVersion++;
    this.setData({ series: [], loading: false });
  },
  async load() {
    if (this.wasHidden || this.pageClosed) return;
    const version = ++this.requestVersion;
    const { q, category } = this.data;
    this.setData({ loading: true, error: '', series: [] });
    try {
      const r = await listSeries(q, category);
      if (this.wasHidden || this.pageClosed || version !== this.requestVersion) return;
      this.setData({ series: r.series });
    } catch {
      if (this.wasHidden || this.pageClosed || version !== this.requestVersion) return;
      this.setData({ error: '内容加载失败，请稍后重试' });
    } finally {
      if (!this.wasHidden && !this.pageClosed && version === this.requestVersion)
        this.setData({ loading: false });
    }
  },
  onQuery(e: WechatMiniprogram.Input) {
    if (this.wasHidden || this.pageClosed) return;
    this.setData({ q: e.detail.value });
  },
  search() {
    if (this.wasHidden || this.pageClosed) return;
    void this.load();
  },
  open(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    if (
      id &&
      !this.wasHidden &&
      !this.pageClosed &&
      !this.data.loading &&
      !this.data.error &&
      this.data.series.some((series) => series.id === id)
    )
      void wx.navigateTo({ url: `/pages/story-detail/story-detail?id=${encodeURIComponent(id)}` });
  },
});
