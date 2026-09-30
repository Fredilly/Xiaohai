import { createStoryWork, StoryApiError } from '../../services/story';
import type { StoryCreationMode } from '@xiaohai/contracts/story';

type InputEvent = {
  currentTarget: { dataset: { field?: string } };
  detail: { value?: string };
};

const CREATE_DRAFT_KEY = 'story_create_form_draft_v1';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const isCreationMode = (value: string): value is StoryCreationMode =>
  value === 'DIRECT_BODY' || value === 'OUTLINE_FIRST';

Page({
  data: {
    isLoggedIn: false,
    title: '',
    idea: '',
    ageRange: '6-8岁',
    theme: '',
    style: '温暖童话',
    creationMode: 'OUTLINE_FIRST',
    restored: false,
    saveStatus: '',
    loading: false,
    submitted: false,
    errorMessage: '',
  },

  onShow() {
    if (!this.data.restored) {
      const raw: unknown = wx.getStorageSync(CREATE_DRAFT_KEY);

      if (raw && typeof raw === 'object') {
        const saved = raw as Record<string, unknown>;
        const savedString = (field: string, fallback: string) => {
          const value = saved[field];
          return typeof value === 'string' ? value : fallback;
        };
        this.setData({
          title: savedString('title', this.data.title),
          idea: savedString('idea', this.data.idea),
          ageRange: savedString('ageRange', this.data.ageRange),
          theme: savedString('theme', this.data.theme),
          style: savedString('style', this.data.style),
          creationMode: saved['creationMode'] === 'DIRECT_BODY' ? 'DIRECT_BODY' : 'OUTLINE_FIRST',
          saveStatus: '已恢复上次未完成的创作信息',
        });
      }
    }

    this.setData({
      isLoggedIn: Boolean(wx.getStorageSync('consumer_session_token')),
      restored: true,
    });
  },

  onUnload() {
    if (saveTimer) clearTimeout(saveTimer);
    if (!this.data.submitted) this.saveLocalDraft();
  },

  input(event: InputEvent) {
    const field = String(event.currentTarget.dataset.field || '');
    const value = String(event.detail.value || '');

    if (!['title', 'idea', 'ageRange', 'theme', 'style'].includes(field)) return;

    this.setData({ [field]: value });
    this.scheduleLocalSave();
  },

  chooseMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode || '');
    if (!isCreationMode(mode)) return;
    this.setData({ creationMode: mode });
    this.scheduleLocalSave();
  },

  scheduleLocalSave() {
    this.setData({ saveStatus: '正在保存…' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => this.saveLocalDraft(), 500);
  },

  saveLocalDraft() {
    saveTimer = null;
    wx.setStorageSync(CREATE_DRAFT_KEY, {
      title: this.data.title,
      idea: this.data.idea,
      ageRange: this.data.ageRange,
      theme: this.data.theme,
      style: this.data.style,
      creationMode: this.data.creationMode,
    });
    this.setData({ saveStatus: '创作信息已自动保存' });
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
        creationMode: isCreationMode(this.data.creationMode)
          ? this.data.creationMode
          : 'OUTLINE_FIRST',
      });

      wx.removeStorageSync(CREATE_DRAFT_KEY);
      this.setData({ submitted: true });

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
