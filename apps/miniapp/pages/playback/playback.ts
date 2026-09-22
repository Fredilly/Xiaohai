import { getPlayback, saveProgress } from '../../services/content';
Page({
  data: {
    access: null as Awaited<ReturnType<typeof getPlayback>> | null,
    error: '',
    episodeId: '',
    loading: false,
    position: 0,
  },
  onLoad(query: Record<string, string | undefined>) {
    if (query.id) {
      this.setData({ episodeId: query.id });
      void this.load(query.id);
    } else this.setData({ error: '播放参数无效' });
  },
  async load(id: string) {
    this.setData({ loading: true, error: '' });
    try {
      const access = await getPlayback(id);
      this.setData({ access, position: Math.floor(access.resumePositionSeconds ?? 0) });
    } catch {
      this.setData({ access: null });
      this.setData({ error: '无法获取播放权限，请登录或稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },
  retry() {
    if (this.data.episodeId) void this.load(this.data.episodeId);
  },
  onHide() {
    wx.createVideoContext('player').pause();
  },
  playbackError() {
    this.setData({ error: '视频暂时无法播放，请检查网络后重试。' });
  },
  time(e: WechatMiniprogram.VideoTimeUpdate) {
    const a = this.data.access;
    if (!a || a.access === 'LOCKED') return;
    const position = Math.floor(e.detail.currentTime);
    this.setData({ position });
    if (a.access === 'PREVIEW' && a.previewSeconds && position >= a.previewSeconds) {
      wx.createVideoContext('player').pause();
    }
    if (position % 10 === 0)
      void saveProgress(this.data.episodeId, position, false).catch(() => undefined);
  },
  ended() {
    if (this.data.access?.access !== 'FULL') return;
    void saveProgress(this.data.episodeId, this.data.position, true).catch(() => undefined);
  },
});
