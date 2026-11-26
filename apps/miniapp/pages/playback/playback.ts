import { getPlayback, saveProgress } from '../../services/content';
import { consumerToken } from '../../services/consumer-session';

Page({
  readSequence: 0,
  wasHidden: false,
  activeSession: '',
  playbackEnded: false,
  lastProgressCheckpoint: -1,
  progressWrites: Promise.resolve(),
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
  onShow() {
    if (!this.wasHidden) return;
    this.wasHidden = false;
    if (this.data.episodeId) void this.load(this.data.episodeId);
  },
  async load(id: string) {
    const sequence = ++this.readSequence;
    const session = consumerToken();
    this.activeSession = '';
    this.playbackEnded = false;
    this.lastProgressCheckpoint = -1;
    this.setData({ loading: true, error: '', access: null, position: 0 });
    try {
      const access = await getPlayback(id);
      if (sequence !== this.readSequence || this.wasHidden) return;
      if (consumerToken() !== session) {
        if (consumerToken()) void this.load(id);
        else this.setData({ error: '登录状态已变更，请重新登录后重试。' });
        return;
      }
      if (access.access !== 'LOCKED' && !access.playbackUrl) {
        throw new Error('MEDIA_UNAVAILABLE');
      }
      this.activeSession = session;
      this.setData({ access, position: Math.floor(access.resumePositionSeconds ?? 0) });
    } catch {
      if (sequence !== this.readSequence || this.wasHidden) return;
      if (consumerToken() !== session && consumerToken()) {
        void this.load(id);
        return;
      }
      this.setData({ access: null, error: '无法获取播放权限，请登录或稍后重试' });
    } finally {
      if (sequence === this.readSequence && !this.wasHidden) this.setData({ loading: false });
    }
  },
  retry() {
    if (this.data.episodeId) void this.load(this.data.episodeId);
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.activeSession = '';
    this.playbackEnded = false;
    wx.createVideoContext('player').pause();
    this.setData({ access: null, position: 0, loading: false, error: '' });
  },
  onUnload() {
    this.wasHidden = true;
    this.readSequence++;
  },
  playbackError() {
    this.setData({ access: null, error: '视频暂时无法播放，请检查网络后重试。' });
  },
  time(e: WechatMiniprogram.VideoTimeUpdate) {
    const a = this.data.access;
    if (!a || a.access === 'LOCKED' || this.playbackEnded) return;
    if (consumerToken() !== this.activeSession) {
      this.readSequence++;
      this.activeSession = '';
      wx.createVideoContext('player').pause();
      this.setData({ access: null, position: 0, error: '登录状态已变更，请重新加载。' });
      return;
    }
    const position = Math.max(0, Math.floor(e.detail.currentTime));
    this.setData({ position });
    if (a.access === 'PREVIEW' && a.previewSeconds && position >= a.previewSeconds) {
      wx.createVideoContext('player').pause();
    }
    if (
      this.activeSession &&
      position > 0 &&
      position % 10 === 0 &&
      position !== this.lastProgressCheckpoint
    ) {
      this.lastProgressCheckpoint = position;
      this.queueProgress(position, false);
    }
  },
  ended() {
    if (this.data.access?.access !== 'FULL' || !this.activeSession) return;
    if (consumerToken() !== this.activeSession) return;
    this.playbackEnded = true;
    this.queueProgress(this.data.position, true);
  },
  queueProgress(position: number, completed: boolean) {
    const sequence = this.readSequence;
    const session = this.activeSession;
    const episodeId = this.data.episodeId;
    // Serialize partial checkpoints before completion so an older delayed write
    // cannot overwrite a successfully completed episode with completed=false.
    this.progressWrites = this.progressWrites.then(async () => {
      // A completed episode still needs to be saved after the user leaves the page.
      // An account change always cancels even that pending completion write.
      if (
        (!completed && (sequence !== this.readSequence || this.wasHidden)) ||
        consumerToken() !== session
      )
        return;
      try {
        await saveProgress(episodeId, position, completed);
      } catch {
        // Network failures are retryable on the next playback checkpoint.
      }
    });
  },
});
