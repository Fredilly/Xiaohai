import { createPictureBook, PictureBookApiError } from '../../services/picture-book';

type InputEvent = { detail: { value?: string } };

Page({
  data: {
    workId: '',
    versionId: '',
    title: '',
    submitting: false,
    creationUnknown: false,
    error: '',
  },
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
    if (
      this.data.submitting ||
      this.data.creationUnknown ||
      !this.data.workId ||
      !this.data.versionId ||
      !this.data.title.trim()
    ) {
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const book = await createPictureBook({
        storyWorkId: this.data.workId,
        sourceStoryVersionId: this.data.versionId,
        title: this.data.title.trim(),
      });
      void wx.redirectTo({ url: `/pages/picture-book-detail/picture-book-detail?id=${book.id}` });
    } catch (error) {
      // A timed-out POST may have created the book despite losing its response.
      // Require an explicit check in "我的绘本" before any new attempt.
      const creationUnknown =
        !(error instanceof PictureBookApiError) || (error.status >= 500 && error.status !== 503);
      this.setData({
        creationUnknown,
        error: creationUnknown
          ? '创建结果暂时无法确认，请先到“我的绘本”检查，避免重复创建。'
          : error instanceof PictureBookApiError && error.status === 503
            ? '绘本功能尚未开启'
            : '创建失败，请确认正文版本仍然有效。',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
  viewExisting() {
    void wx.redirectTo({ url: '/pages/picture-books/picture-books' });
  },
});
