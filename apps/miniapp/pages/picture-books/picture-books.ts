import type { PictureBook } from '@xiaohai/contracts/picture-book';
import { listPictureBooks } from '../../services/picture-book';

Page({
  data: { loading: true, error: '', books: [] as PictureBook[] },
  onShow() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await listPictureBooks();
      this.setData({ books: result.pictureBooks });
    } catch {
      this.setData({ error: '绘本加载失败，请检查登录状态和网络。' });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) void wx.navigateTo({ url: `/pages/picture-book-detail/picture-book-detail?id=${id}` });
  },
});
