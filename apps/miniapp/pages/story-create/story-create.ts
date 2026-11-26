import { createStoryWork, StoryApiError } from '../../services/story';
import { consumerToken } from '../../services/consumer-session';

type InputEvent = {
  currentTarget: { dataset: { field?: string } };
  detail: { value?: string };
};

Page({
  activeSession: '',
  wasHidden: false,
  pageClosed: false,
  navigating: false,
  data: {
    isLoggedIn: false,
    title: '',
    idea: '',
    ageRange: '6-8岁',
    theme: '',
    style: '温暖童话',
    loading: false,
    creationUnknown: false,
    createdWorkId: '',
    errorMessage: '',
  },

  onShow() {
    this.wasHidden = false;
    const session = consumerToken();
    if (session !== this.activeSession) {
      this.activeSession = session;
      this.navigating = false;
      this.setData({
        isLoggedIn: Boolean(session),
        title: '',
        idea: '',
        ageRange: '6-8岁',
        theme: '',
        style: '温暖童话',
        loading: false,
        creationUnknown: false,
        createdWorkId: '',
        errorMessage: '',
      });
      return;
    }
    this.setData({ isLoggedIn: Boolean(session) });
    if (this.data.createdWorkId) this.openCreated();
  },

  onHide() {
    this.wasHidden = true;
  },

  onUnload() {
    this.pageClosed = true;
  },

  invalidateSession() {
    this.activeSession = '';
    this.setData({
      isLoggedIn: false,
      title: '',
      idea: '',
      ageRange: '6-8岁',
      theme: '',
      style: '温暖童话',
      loading: false,
      creationUnknown: false,
      createdWorkId: '',
      errorMessage: '登录状态已变化，请重新登录后创建故事。',
    });
  },

  input(event: InputEvent) {
    if (this.pageClosed || this.data.loading || this.activeSession !== consumerToken()) return;
    const field = String(event.currentTarget.dataset.field || '');
    const value = String(event.detail.value || '');

    if (!['title', 'idea', 'ageRange', 'theme', 'style'].includes(field)) return;

    this.setData({ [field]: value });
  },

  goLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },

  async submit() {
    if (
      this.pageClosed ||
      this.data.loading ||
      this.data.creationUnknown ||
      this.data.createdWorkId
    )
      return;
    const session = this.activeSession;
    if (!session || !this.data.isLoggedIn) {
      this.goLogin();
      return;
    }
    if (session !== consumerToken()) {
      this.invalidateSession();
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

      if (this.pageClosed) return;
      if (session !== this.activeSession) return;
      if (session !== consumerToken()) {
        this.invalidateSession();
        return;
      }
      this.setData({ createdWorkId: work.id });
      if (!this.wasHidden) this.openCreated();
    } catch (error) {
      if (this.pageClosed) return;
      if (session !== this.activeSession) return;
      if (session !== consumerToken()) {
        this.invalidateSession();
        return;
      }
      const creationUnknown =
        !(error instanceof StoryApiError) || (error.status >= 500 && error.status !== 503);
      const message = creationUnknown
        ? '创建结果无法确认，请先到“我的 AI 作品”检查，避免重复创建。'
        : error instanceof StoryApiError && error.status === 401
          ? '登录状态已失效，请重新登录'
          : error instanceof StoryApiError && error.status === 503
            ? '故事功能尚未开启'
            : '创建故事失败，请检查信息后重试';

      this.setData({ creationUnknown, errorMessage: message });
    } finally {
      if (!this.pageClosed && this.activeSession === session) this.setData({ loading: false });
    }
  },

  openCreated() {
    if (
      this.pageClosed ||
      this.wasHidden ||
      this.navigating ||
      !this.data.createdWorkId ||
      !this.activeSession ||
      this.activeSession !== consumerToken()
    )
      return;
    this.navigating = true;
    void wx.redirectTo({
      url: `/pages/story-work/story-work?id=${encodeURIComponent(this.data.createdWorkId)}`,
      fail: () => {
        this.navigating = false;
      },
    });
  },

  openWorks() {
    if (this.pageClosed || this.activeSession !== consumerToken()) return;
    void wx.navigateTo({ url: '/pages/story-works/story-works' });
  },
});
