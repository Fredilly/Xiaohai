import { createPictureBook, PictureBookApiError } from '../../services/picture-book';
import { consumerToken } from '../../services/consumer-session';

type InputEvent = { detail: { value?: string } };

Page({
  sourceSession: '',
  wasHidden: false,
  pageClosed: false,
  navigating: false,
  data: {
    workId: '',
    versionId: '',
    title: '',
    submitting: false,
    creationUnknown: false,
    createdId: '',
    error: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    this.sourceSession = consumerToken();
    this.setData({
      workId: String(query.workId || ''),
      versionId: String(query.versionId || ''),
      title: `${String(query.title || '我的故事')}绘本`,
    });
  },
  onShow() {
    this.wasHidden = false;
    if (!this.sourceSession || this.sourceSession !== consumerToken()) {
      this.invalidateSource();
      return;
    }
    if (this.data.createdId) this.openCreated();
  },
  onHide() {
    this.wasHidden = true;
  },
  onUnload() {
    this.pageClosed = true;
  },
  invalidateSource() {
    this.sourceSession = '';
    this.setData({
      workId: '',
      versionId: '',
      title: '',
      createdId: '',
      submitting: false,
      creationUnknown: false,
      error: '登录状态已变化，请返回我的故事重新选择正文版本。',
    });
  },
  inputTitle(event: InputEvent) {
    if (this.pageClosed || this.sourceSession !== consumerToken()) return;
    this.setData({ title: String(event.detail.value || '') });
  },
  async submit() {
    if (
      this.pageClosed ||
      this.data.submitting ||
      this.data.creationUnknown ||
      this.data.createdId ||
      !this.data.workId ||
      !this.data.versionId ||
      !this.data.title.trim()
    ) {
      return;
    }
    const session = this.sourceSession;
    if (!session || session !== consumerToken()) {
      this.invalidateSource();
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const book = await createPictureBook({
        storyWorkId: this.data.workId,
        sourceStoryVersionId: this.data.versionId,
        title: this.data.title.trim(),
      });
      if (this.pageClosed) return;
      if (session !== consumerToken() || session !== this.sourceSession) {
        this.invalidateSource();
        return;
      }
      this.setData({ createdId: book.id });
      if (!this.wasHidden) this.openCreated();
    } catch (error) {
      if (this.pageClosed) return;
      if (session !== consumerToken() || session !== this.sourceSession) {
        this.invalidateSource();
        return;
      }
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
      if (!this.pageClosed && session === this.sourceSession) this.setData({ submitting: false });
    }
  },
  openCreated() {
    if (
      this.pageClosed ||
      this.wasHidden ||
      this.navigating ||
      !this.data.createdId ||
      !this.sourceSession ||
      this.sourceSession !== consumerToken()
    )
      return;
    this.navigating = true;
    void wx.redirectTo({
      url: `/pages/picture-book-detail/picture-book-detail?id=${encodeURIComponent(this.data.createdId)}`,
      fail: () => {
        this.navigating = false;
      },
    });
  },
  viewExisting() {
    if (this.pageClosed || this.sourceSession !== consumerToken()) return;
    void wx.redirectTo({ url: '/pages/picture-books/picture-books' });
  },
});
