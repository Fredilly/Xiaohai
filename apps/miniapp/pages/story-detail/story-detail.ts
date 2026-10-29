import { getSeries } from '../../services/content';
import { detailAccessMessage } from '../../utils/detail-read-error';

Page({
  data: {
    id: '',
    detail: null as Awaited<ReturnType<typeof getSeries>> | null,
    error: '',
    accessMessage: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ?? '';
    this.setData({ id });
    if (id) void this.load(id);
    else this.setData({ error: '缺少故事编号' });
  },
  async load(id: string) {
    this.setData({ detail: null, error: '', accessMessage: '' });
    try {
      this.setData({ detail: await getSeries(id) });
    } catch (error) {
      this.setData({
        error: '内容详情加载失败',
        accessMessage: detailAccessMessage(error),
      });
    }
  },
  retry() {
    if (this.data.id && this.data.error && !this.data.accessMessage)
      void this.load(this.data.id);
  },
  play(e: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/playback/playback?id=${String(e.currentTarget.dataset.id)}`,
    });
  },
});
