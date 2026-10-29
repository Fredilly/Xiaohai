import type { StoryWork } from '@xiaohai/contracts/story';
import { consumerToken } from '../../services/consumer-session';
import { StoryApiError, listStoryWorks } from '../../services/story';

Page({
  data: {
    loading: true,
    error: false,
    needsLogin: false,
    works: [] as StoryWork[],
  },

  onShow() {
    void this.load();
  },

  async load() {
    if (!consumerToken()) {
      this.setData({ works: [], loading: false, error: false, needsLogin: true });
      return;
    }

    this.setData({ loading: true, error: false, needsLogin: false });
    try {
      const result = await listStoryWorks();
      this.setData({ works: result.works, loading: false, needsLogin: false });
    } catch (error) {
      const needsLogin = error instanceof StoryApiError && error.status === 401;
      this.setData({ works: [], loading: false, error: !needsLogin, needsLogin });
    }
  },

  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },

  openWork(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;

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
