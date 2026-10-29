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
  // BOS playback URLs are short-lived bearer links. Refresh metadata via the
  // existing authenticated GET, never by regenerating images or extending TTL.
  refreshAfterHide: false,
  requestVersion: 0,
  imageRefreshInProgress: false,
  imageRefreshAttempted: {} as Record<string, boolean>,
  onLoad(query: Record<string, string | undefined>) {
    const id = String(query.id || '');
    this.setData({ id });
    if (id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  onHide() {
    this.refreshAfterHide = true;
  },
  onShow() {
    if (!this.refreshAfterHide || !this.data.id) return;
    this.refreshAfterHide = false;
    void this.load();
  },
  onUnload() {
    this.requestVersion += 1;
  },
  async load() {
    const version = ++this.requestVersion;
    this.imageRefreshAttempted = {};
    this.setData({ loading: true, error: '' });
    try {
      const detail = await getPictureBook(this.data.id);
      if (version !== this.requestVersion) return;
      this.setData({
        detail,
        pages: buildPictureBookPreview(detail),
        imageErrors: {},
      });
    } catch {
      if (version !== this.requestVersion) return;
      this.setData({ detail: null, pages: [], error: '整书预览加载失败，请重试。' });
    } finally {
      if (version === this.requestVersion) this.setData({ loading: false });
    }
  },
  retry() {
    void this.load();
  },
  async onImageError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    const pageId = String(event.currentTarget.dataset.pageId || '');
    if (!pageId) return;
    this.setData({ [`imageErrors.${pageId}`]: true });
    if (
      !this.data.id ||
      !this.data.pages.some((page) => page.id === pageId && page.imageUrl) ||
      this.imageRefreshAttempted[pageId] ||
      this.imageRefreshInProgress
    ) {
      return;
    }

    // At most one automatic refresh per failed page per visit. A new signed
    // URL must differ from the failed one; unchanged or failed reads stay hidden.
    this.imageRefreshAttempted[pageId] = true;
    this.imageRefreshInProgress = true;
    const version = this.requestVersion;
    const previousPages = this.data.pages;
    try {
      const detail = await getPictureBook(this.data.id);
      if (version !== this.requestVersion) return;
      const pages = buildPictureBookPreview(detail);
      const imageErrors = { ...this.data.imageErrors };
      for (const page of pages) {
        const previous = previousPages.find((item) => item.id === page.id);
        if (page.imageUrl && page.imageUrl !== previous?.imageUrl) {
          delete imageErrors[page.id];
        }
      }
      this.setData({ detail, pages, imageErrors });
    } catch {
      // Do not expose private URL, provider error, or repeatedly request metadata.
      // The existing image fallback remains visible until a later page reload.
    } finally {
      this.imageRefreshInProgress = false;
    }
  },
});
