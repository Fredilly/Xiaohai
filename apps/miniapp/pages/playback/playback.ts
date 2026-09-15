import { getPlayback, saveProgress } from '../../services/content';
Page({
  data: {
    access: null as Awaited<ReturnType<typeof getPlayback>> | null,
    error: '',
    episodeId: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    if (query.id) {
      this.setData({ episodeId: query.id });
      void this.load(query.id);
    }
  },
  async load(id: string) {
    try {
      this.setData({ access: await getPlayback(id) });
    } catch {
      this.setData({ error: '无法获取播放权限，请登录或稍后重试' });
    }
  },
  time(e: WechatMiniprogram.VideoTimeUpdate) {
    const a = this.data.access;
    if (!a || a.access === 'LOCKED') return;
    const position = Math.floor(e.detail.currentTime);
    if (a.access === 'PREVIEW' && a.previewSeconds && position >= a.previewSeconds) {
      wx.createVideoContext('player').pause();
    }
    if (position % 10 === 0)
      void saveProgress(this.data.episodeId, position, false).catch(() => undefined);
  },
  ended() {
    void saveProgress(
      this.data.episodeId,
      Math.floor(this.data.access?.resumePositionSeconds ?? 0),
      true,
    ).catch(() => undefined);
  },
});
