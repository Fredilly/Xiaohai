import { getSeries } from '../../services/content';
Page({
  data: { detail: null as Awaited<ReturnType<typeof getSeries>> | null, error: '' },
  onLoad(query: Record<string, string | undefined>) {
    if (query.id) void this.load(query.id);
  },
  async load(id: string) {
    try {
      this.setData({ detail: await getSeries(id) });
    } catch {
      this.setData({ error: '内容详情加载失败' });
    }
  },
  play(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/playback/playback?id=${String(e.currentTarget.dataset.id)}` });
  },
});
