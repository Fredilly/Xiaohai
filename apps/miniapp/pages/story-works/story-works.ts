import type { StoryWork } from '@xiaohai/contracts/story';
import { consumerToken } from '../../services/consumer-session';
import { StoryApiError, listStoryWorks } from '../../services/story';

Page({
  readSequence: 0,
  wasHidden: false,
  loadedSession: '',
  data: {
    loading: true,
    error: false,
    needsLogin: false,
    works: [] as StoryWork[],
  },

  onShow() {
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ works: [], loading: false });
  },
  onUnload() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
  },

  async load() {
    if (this.wasHidden) return;
    const version = ++this.readSequence;
    const session = consumerToken();
    this.loadedSession = '';
    if (!session) {
      this.setData({ works: [], loading: false, error: false, needsLogin: true });
      return;
    }

    this.setData({ works: [], loading: true, error: false, needsLogin: false });
    try {
      const result = await listStoryWorks();
      if (version !== this.readSequence || this.wasHidden) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ works: [], loading: false, error: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      this.loadedSession = session;
      this.setData({ works: result.works, loading: false, needsLogin: false });
    } catch (error) {
      if (version !== this.readSequence || this.wasHidden) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ works: [], loading: false, error: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      const needsLogin = error instanceof StoryApiError && error.status === 401;
      this.setData({ works: [], loading: false, error: !needsLogin, needsLogin });
    }
  },

  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },

  openWork(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id || !this.loadedSession || this.loadedSession !== consumerToken() || this.wasHidden)
      return;

    void wx.navigateTo({
      url: `/pages/story-work/story-work?id=${encodeURIComponent(id)}`,
    });
  },

  createStory() {
    void wx.navigateTo({ url: '/pages/story-create/story-create' });
  },

  openPictureBooks() {
    void wx.navigateTo({ url: '/pages/picture-books/picture-books' });
  },

  retry() {
    void this.load();
  },
});
