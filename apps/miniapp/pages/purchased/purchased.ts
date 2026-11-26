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
  data: {
    needsLogin: false,
    loading: false,
    purchased: [] as PurchasedSeries[],
    continueItems: [] as ContinueItem[],
    purchasedError: false,
    continueError: false,
  },
  onShow() {
    void this.load();
  },
  onHide() {
    this.readSequence++;
    // Neither account's private viewing history should linger on a hidden page.
    this.setData({ purchased: [], continueItems: [] });
  },
  onUnload() {
    this.readSequence++;
  },
  async load() {
    const version = ++this.readSequence;
    const session = consumerToken();
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
    if (version !== this.readSequence) return;
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
    if (id && !this.data.needsLogin)
      void wx.navigateTo({ url: `/pages/story-detail/story-detail?id=${encodeURIComponent(id)}` });
  },
  resume(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id && !this.data.needsLogin)
      void wx.navigateTo({ url: `/pages/playback/playback?id=${encodeURIComponent(id)}` });
  },
  coverError(event: WechatMiniprogram.TouchEvent) {
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
