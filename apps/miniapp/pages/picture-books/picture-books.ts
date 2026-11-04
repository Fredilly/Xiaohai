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
  onShow() {
    void this.load();
  },
  async load() {
    if (!consumerToken()) {
      this.setData({ loading: false, error: '', needsLogin: true, books: [], imageErrors: {} });
      return;
    }

    this.setData({ loading: true, error: '', needsLogin: false });
    try {
      const result = await listPictureBooks();
      this.setData({ books: result.pictureBooks, imageErrors: {}, loading: false });
    } catch (error) {
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
    if (id) void wx.navigateTo({ url: `/pages/picture-book-detail/picture-book-detail?id=${id}` });
  },
  onCoverError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) this.setData({ [`imageErrors.${id}`]: true });
  },
});
