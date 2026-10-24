import { getSeries } from '../../services/content';

Page({
  data: {
    id: '',
    detail: null as Awaited<ReturnType<typeof getSeries>> | null,
    error: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ?? '';
    this.setData({ id });
    if (id) void this.load(id);
    else this.setData({ error: '缺少故事编号' });
  },
  async load(id: string) {
    this.setData({ detail: null, error: '' });
    try {
      this.setData({ detail: await getSeries(id) });
    } catch {
      this.setData({ error: '内容详情加载失败' });
    }
  },
  retry() {
    if (this.data.id) void this.load(this.data.id);
  },
  play(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/playback/playback?id=${String(e.currentTarget.dataset.id)}`,
    });
  },
});
