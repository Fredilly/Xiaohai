import { createPictureBook, PictureBookApiError } from '../../services/picture-book';

type InputEvent = { detail: { value?: string } };

Page({
  data: { workId: '', versionId: '', title: '', submitting: false, error: '' },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      workId: String(query.workId || ''),
      versionId: String(query.versionId || ''),
      title: `${String(query.title || '我的故事')}绘本`,
    });
  },
  inputTitle(event: InputEvent) {
    this.setData({ title: String(event.detail.value || '') });
  },
  async submit() {
    if (!this.data.workId || !this.data.versionId || !this.data.title.trim()) return;
    this.setData({ submitting: true, error: '' });
    try {
      const book = await createPictureBook({
        storyWorkId: this.data.workId,
        sourceStoryVersionId: this.data.versionId,
        title: this.data.title.trim(),
      });
      void wx.redirectTo({ url: `/pages/picture-book-detail/picture-book-detail?id=${book.id}` });
    } catch (error) {
      this.setData({
        error:
          error instanceof PictureBookApiError && error.status === 503
            ? '绘本功能尚未开启'
            : '创建失败，请确认正文版本仍然有效。',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
