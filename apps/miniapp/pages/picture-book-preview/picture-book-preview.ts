import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import { getPictureBook } from '../../services/picture-book';
import {
  buildPictureBookPreview,
  type PictureBookPreviewPage,
} from '../../services/picture-book-preview';

Page({
  data: {
    id: '',
    detail: null as PictureBookDetail | null,
    pages: [] as PictureBookPreviewPage[],
    loading: true,
    error: '',
    imageErrors: {} as Record<string, boolean>,
  },
  onLoad(query: Record<string, string | undefined>) {
    const id = String(query.id || '');
    this.setData({ id });
    if (id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const detail = await getPictureBook(this.data.id);
      this.setData({
        detail,
        pages: buildPictureBookPreview(detail),
        imageErrors: {},
      });
    } catch {
      this.setData({ detail: null, pages: [], error: '整书预览加载失败，请重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },
  retry() {
    void this.load();
  },
  onImageError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    const pageId = String(event.currentTarget.dataset.pageId || '');
    if (pageId) this.setData({ [`imageErrors.${pageId}`]: true });
  },
});
