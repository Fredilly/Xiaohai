import { createStoryWork, StoryApiError } from '../../services/story';

type InputEvent = {
  currentTarget: { dataset: { field?: string } };
  detail: { value?: string };
};

Page({
  data: {
    isLoggedIn: false,
    title: '',
    idea: '',
    ageRange: '6-8岁',
    theme: '',
    style: '温暖童话',
    loading: false,
    errorMessage: '',
  },

  onShow() {
    this.setData({
      isLoggedIn: Boolean(wx.getStorageSync('consumer_session_token')),
    });
  },

  input(event: InputEvent) {
    const field = String(event.currentTarget.dataset.field || '');
    const value = String(event.detail.value || '');

    if (!['title', 'idea', 'ageRange', 'theme', 'style'].includes(field)) return;

    this.setData({ [field]: value });
  },

  goLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },

  async submit() {
    if (!this.data.isLoggedIn) {
      this.goLogin();
      return;
    }

    const idea = this.data.idea.trim();
    const ageRange = this.data.ageRange.trim();
    const theme = this.data.theme.trim();
    const style = this.data.style.trim();

    if (!idea || !ageRange || !theme || !style) {
      void wx.showToast({ title: '请把创作信息填写完整', icon: 'none' });
      return;
    }

    this.setData({ loading: true, errorMessage: '' });

    try {
      const work = await createStoryWork({
        title: this.data.title.trim() || undefined,
        idea,
        ageRange,
        theme,
        style,
      });

      void wx.redirectTo({
        url: `/pages/story-work/story-work?id=${encodeURIComponent(work.id)}`,
      });
    } catch (error) {
      const message =
        error instanceof StoryApiError && error.status === 401
          ? '登录状态已失效，请重新登录'
          : '创建故事失败，请稍后重试';

      this.setData({ errorMessage: message });
    } finally {
      this.setData({ loading: false });
    }
  },

  openWorks() {
    void wx.navigateTo({ url: '/pages/story-works/story-works' });
  },
});
