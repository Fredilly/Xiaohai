import type { StoryWork } from '@xiaohai/contracts/story';
import { listStoryWorks } from '../../services/story';

type DisplayStoryWork = StoryWork & { stateLabel: string };

Page({
  data: {
    loading: true,
    error: false,
    works: [] as DisplayStoryWork[],
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: false });

    try {
      const result = await listStoryWorks();
      this.setData({
        works: result.works.map((work) => ({
          ...work,
          stateLabel: work.draftKinds.includes('BODY')
            ? '正文草稿待确认'
            : work.draftKinds.includes('OUTLINE')
              ? '大纲草稿待确认'
              : work.hasConfirmedBody
                ? '已有确认正文'
                : '创作信息草稿',
        })),
        loading: false,
      });
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

  openPictureBooks() {
    void wx.navigateTo({ url: '/pages/picture-books/picture-books' });
  },

  retry() {
    void this.load();
  },
});
