import type { StoryWork } from '@xiaohai/contracts/story';
import { listStoryWorks } from '../../services/story';

Page({
  data: {
    loading: true,
    error: false,
    works: [] as StoryWork[],
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: false });

    try {
      const result = await listStoryWorks();
      this.setData({ works: result.works, loading: false });
    } catch {
      this.setData({ loading: false, error: true, works: [] });
    }
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

  retry() {
    void this.load();
  },
});
