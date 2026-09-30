import { createStoryWork, StoryApiError } from '../../services/story';
import { storedConsumerId } from '../../services/consumer-session';
import type { StoryCreationMode } from '@xiaohai/contracts/story';

type InputEvent = {
  currentTarget: { dataset: { field?: string } };
  detail: { value?: string };
};

const LEGACY_CREATE_DRAFT_KEY = 'story_create_form_draft_v1';
const CREATE_DRAFT_KEY_PREFIX = 'story_create_form_draft_v2';
const defaultForm = {
  title: '',
  idea: '',
  ageRange: '6-8岁',
  theme: '',
  style: '温暖童话',
  creationMode: 'OUTLINE_FIRST' as StoryCreationMode,
};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const isCreationMode = (value: string): value is StoryCreationMode =>
  value === 'DIRECT_BODY' || value === 'OUTLINE_FIRST';
const draftKey = (consumerUserId: string) =>
  `${CREATE_DRAFT_KEY_PREFIX}:${encodeURIComponent(consumerUserId)}`;

Page({
  data: {
    isLoggedIn: false,
    consumerUserId: '',
    ...defaultForm,
    restored: false,
    saveStatus: '',
    loading: false,
    submitted: false,
    errorMessage: '',
  },

  onShow() {
    const consumerUserId = storedConsumerId();
    const sessionChanged = consumerUserId !== this.data.consumerUserId;

    // The unscoped legacy key may contain another user's form and must never be restored.
    wx.removeStorageSync(LEGACY_CREATE_DRAFT_KEY);

    if (sessionChanged && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (sessionChanged && this.data.consumerUserId && !this.data.submitted) {
      this.saveLocalDraft(this.data.consumerUserId, false);
    }

    if (!this.data.restored || sessionChanged) {
      const raw: unknown = consumerUserId ? wx.getStorageSync(draftKey(consumerUserId)) : null;
      const restored = raw && typeof raw === 'object';
      const saved = restored ? (raw as Record<string, unknown>) : {};
      const savedString = (field: string, fallback: string) => {
        const value = saved[field];
        return typeof value === 'string' ? value : fallback;
      };

      this.setData({
        ...defaultForm,
        title: savedString('title', defaultForm.title),
        idea: savedString('idea', defaultForm.idea),
        ageRange: savedString('ageRange', defaultForm.ageRange),
        theme: savedString('theme', defaultForm.theme),
        style: savedString('style', defaultForm.style),
        creationMode: saved['creationMode'] === 'DIRECT_BODY' ? 'DIRECT_BODY' : 'OUTLINE_FIRST',
        consumerUserId,
        submitted: false,
        saveStatus: restored ? '已恢复上次未完成的创作信息' : '',
        errorMessage: '',
      });
    }

    this.setData({
      isLoggedIn: Boolean(consumerUserId),
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

  saveLocalDraft(consumerUserId?: string, updateStatus = true) {
    saveTimer = null;
    const ownerId = consumerUserId ?? this.data.consumerUserId;
    if (!ownerId) return;
    wx.setStorageSync(draftKey(ownerId), {
      title: this.data.title,
      idea: this.data.idea,
      ageRange: this.data.ageRange,
      theme: this.data.theme,
      style: this.data.style,
      creationMode: this.data.creationMode,
    });
    if (updateStatus) this.setData({ saveStatus: '创作信息已自动保存' });
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

      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      wx.removeStorageSync(draftKey(this.data.consumerUserId));
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
