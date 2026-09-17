import { AnimationApiError, createAnimation } from '../../services/animation';

type InputEvent = { detail: { value?: string } };
Page({
  data: { workId: '', versionId: '', title: '', submitting: false, error: '' },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      workId: String(query.workId || ''),
      versionId: String(query.versionId || ''),
      title: `${String(query.title || '我的故事')}动画`,
    });
  },
  inputTitle(event: InputEvent) {
    this.setData({ title: String(event.detail.value || '') });
  },
  async submit() {
    if (!this.data.workId || !this.data.versionId || !this.data.title.trim()) return;
    this.setData({ submitting: true, error: '' });
    try {
      const animation = await createAnimation({
        storyWorkId: this.data.workId,
        sourceStoryVersionId: this.data.versionId,
        title: this.data.title.trim(),
      });
      void wx.redirectTo({ url: `/pages/animation-detail/animation-detail?id=${animation.id}` });
    } catch (error) {
      this.setData({
        error:
          error instanceof AnimationApiError && error.status === 503
            ? '动画 AI 尚未开启（安全关闭）'
            : '创建失败，请确认故事正文仍然有效。',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
