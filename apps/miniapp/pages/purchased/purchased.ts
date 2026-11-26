import { getContinueWatching, getEntitlements } from '../../services/content';
import { consumerToken } from '../../services/consumer-session';

type PurchasedSeries = Awaited<ReturnType<typeof getEntitlements>>['series'][number] & {
  displayCoverUrl: string;
};
type ContinueItem = {
  seriesId: string;
  episodeId: string;
  seriesTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  positionMinutes: number;
  displayCoverUrl: string;
};

Page({
  readSequence: 0,
  loadedSession: '',
  wasHidden: false,
  pageClosed: false,
  data: {
    needsLogin: false,
    loading: false,
    purchased: [] as PurchasedSeries[],
    continueItems: [] as ContinueItem[],
    purchasedError: false,
    continueError: false,
  },
  onShow() {
    if (this.pageClosed) return;
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    // Neither account's private viewing history should linger on a hidden page.
    this.setData({ purchased: [], continueItems: [], loading: false });
  },
  onUnload() {
    this.wasHidden = true;
    this.pageClosed = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ purchased: [], continueItems: [] });
  },
  async load() {
    if (this.wasHidden || this.pageClosed) return;
    const version = ++this.readSequence;
    const session = consumerToken();
    this.loadedSession = '';
    if (!session) {
      this.setData({
        needsLogin: true,
        loading: false,
        purchased: [],
        continueItems: [],
        purchasedError: false,
        continueError: false,
      });
      return;
    }

    this.setData({
      needsLogin: false,
      loading: true,
      purchased: [],
      continueItems: [],
      purchasedError: false,
      continueError: false,
    });
    const results = await Promise.allSettled([getEntitlements(), getContinueWatching()]);
    if (version !== this.readSequence || this.wasHidden || this.pageClosed) return;
    const currentSession = consumerToken();
    if (currentSession !== session) {
      this.setData({
        needsLogin: !currentSession,
        loading: false,
        purchased: [],
        continueItems: [],
        purchasedError: false,
        continueError: false,
      });
      if (currentSession) void this.load();
      return;
    }

    const [entitlements, watching] = results;
    this.loadedSession = session;
    this.setData({
      loading: false,
      purchasedError: entitlements.status === 'rejected',
      continueError: watching.status === 'rejected',
      purchased:
        entitlements.status === 'fulfilled'
          ? entitlements.value.series.map((series) => ({
              ...series,
              displayCoverUrl: series.coverUrl || '',
            }))
          : [],
      continueItems:
        watching.status === 'fulfilled'
          ? watching.value.items.map(({ series, episode, progress }) => ({
              seriesId: series.id,
              episodeId: episode.id,
              seriesTitle: series.title,
              episodeTitle: episode.title,
              episodeNumber: episode.episodeNumber,
              positionMinutes: Math.floor(progress.positionSeconds / 60),
              displayCoverUrl: series.coverUrl || '',
            }))
          : [],
    });
  },
  openSeries(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (
      id &&
      !this.wasHidden &&
      !this.pageClosed &&
      !this.data.needsLogin &&
      this.loadedSession &&
      this.loadedSession === consumerToken() &&
      this.data.purchased.some((item) => item.id === id)
    )
      void wx.navigateTo({ url: `/pages/story-detail/story-detail?id=${encodeURIComponent(id)}` });
  },
  resume(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (
      id &&
      !this.wasHidden &&
      !this.pageClosed &&
      !this.data.needsLogin &&
      this.loadedSession &&
      this.loadedSession === consumerToken() &&
      this.data.continueItems.some((item) => item.episodeId === id)
    )
      void wx.navigateTo({ url: `/pages/playback/playback?id=${encodeURIComponent(id)}` });
  },
  coverError(event: WechatMiniprogram.TouchEvent) {
    if (
      this.wasHidden ||
      this.pageClosed ||
      !this.loadedSession ||
      this.loadedSession !== consumerToken()
    )
      return;
    const { section, id, src } = event.currentTarget.dataset as {
      section?: string;
      id?: string;
      src?: string;
    };
    if (!id || !src) return;
    if (section === 'purchased') {
      this.setData({
        purchased: this.data.purchased.map((item) =>
          item.id === id && item.displayCoverUrl === src ? { ...item, displayCoverUrl: '' } : item,
        ),
      });
    } else if (section === 'continue') {
      this.setData({
        continueItems: this.data.continueItems.map((item) =>
          item.episodeId === id && item.displayCoverUrl === src
            ? { ...item, displayCoverUrl: '' }
            : item,
        ),
      });
    }
  },
  backToMe() {
    void wx.navigateBack();
  },
});
