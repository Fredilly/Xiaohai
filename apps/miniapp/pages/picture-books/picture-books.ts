import type { PictureBook } from '@xiaohai/contracts/picture-book';
import { consumerToken } from '../../services/consumer-session';
import { PictureBookApiError, listPictureBooks } from '../../services/picture-book';

Page({
  data: {
    loading: true,
    error: '',
    needsLogin: false,
    books: [] as (PictureBook & { coverPlaybackUrl: string | null })[],
    imageErrors: {},
  },
  requestVersion: 0,
  pageClosed: false,
  wasHidden: false,
  loadedSession: '',
  onShow() {
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.requestVersion++;
    this.loadedSession = '';
    this.setData({ books: [], imageErrors: {}, loading: false });
  },
  onUnload() {
    this.pageClosed = true;
    this.requestVersion += 1;
    this.loadedSession = '';
  },
  async load() {
    if (this.pageClosed || this.wasHidden) return;
    const version = ++this.requestVersion;
    const session = consumerToken();
    this.loadedSession = '';
    if (!session) {
      this.setData({ loading: false, error: '', needsLogin: true, books: [], imageErrors: {} });
      return;
    }

    this.setData({ books: [], imageErrors: {}, loading: true, error: '', needsLogin: false });
    try {
      const result = await listPictureBooks();
      if (this.pageClosed || this.wasHidden || version !== this.requestVersion) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ books: [], imageErrors: {}, loading: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      this.loadedSession = session;
      this.setData({ books: result.pictureBooks, imageErrors: {}, loading: false });
    } catch (error) {
      if (this.pageClosed || this.wasHidden || version !== this.requestVersion) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ books: [], imageErrors: {}, loading: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      const needsLogin = error instanceof PictureBookApiError && error.status === 401;
      this.setData({
        books: [],
        imageErrors: {},
        loading: false,
        needsLogin,
        error: needsLogin ? '' : '绘本加载失败，请检查网络后重试。',
      });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id && !this.wasHidden && this.loadedSession && this.loadedSession === consumerToken())
      void wx.navigateTo({
        url: `/pages/picture-book-detail/picture-book-detail?id=${encodeURIComponent(id)}`,
      });
  },
  onCoverError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    const id = String(event.currentTarget.dataset.id || '');
    const src = String(event.currentTarget.dataset.src || '');
    if (
      !id ||
      !src ||
      this.wasHidden ||
      !this.loadedSession ||
      this.loadedSession !== consumerToken() ||
      !this.data.books.some((book) => book.id === id && book.coverPlaybackUrl === src)
    )
      return;
    this.setData({ imageErrors: { ...this.data.imageErrors, [id]: true } });
  },
});
