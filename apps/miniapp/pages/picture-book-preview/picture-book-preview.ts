import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import { getPictureBook } from '../../services/picture-book';
import { consumerToken } from '../../services/consumer-session';
import {
  buildPictureBookPreview,
  type PictureBookPreviewPage,
} from '../../services/picture-book-preview';

const emptyImageErrors = (): Record<string, boolean> => ({});

export function assertPictureBookPreviewContext(
  detail: PictureBookDetail,
  id: string,
): PictureBookDetail {
  if (
    detail.pictureBook.id !== id ||
    detail.characters.some((character) => character.pictureBookId !== id) ||
    detail.pages.some(
      (page) =>
        page.pictureBookId !== id ||
        page.illustrations.some((illustration) => illustration.pageId !== page.id),
    )
  )
    throw new Error('PICTURE_BOOK_PREVIEW_CONTEXT_MISMATCH');
  return detail;
}

Page({
  data: {
    id: '',
    detail: null as PictureBookDetail | null,
    pages: [] as PictureBookPreviewPage[],
    loading: true,
    error: '',
    imageErrors: emptyImageErrors(),
  },
  // BOS playback URLs are short-lived bearer links. Refresh metadata via the
  // existing authenticated GET, never by regenerating images or extending TTL.
  refreshAfterHide: false,
  pageClosed: false,
  visibleSession: '',
  requestVersion: 0,
  imageRefreshInProgress: false,
  imageRefreshAttempted: emptyImageErrors(),
  onLoad(query: Record<string, string | undefined>) {
    const id = String(query.id || '');
    this.setData({ id });
    if (id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  onHide() {
    this.refreshAfterHide = true;
    this.requestVersion += 1;
    this.visibleSession = '';
    this.imageRefreshAttempted = {};
    this.imageRefreshInProgress = false;
    this.setData({ detail: null, pages: [], imageErrors: {}, loading: false, error: '' });
  },
  onShow() {
    if (!this.refreshAfterHide || !this.data.id || this.pageClosed) return;
    this.refreshAfterHide = false;
    void this.load();
  },
  onUnload() {
    this.pageClosed = true;
    this.requestVersion += 1;
    this.visibleSession = '';
    this.setData({ detail: null, pages: [], imageErrors: {} });
  },
  async load() {
    if (this.pageClosed || this.refreshAfterHide || !this.data.id) return;
    const version = ++this.requestVersion;
    const id = this.data.id;
    const session = consumerToken();
    this.visibleSession = '';
    this.imageRefreshAttempted = {};
    this.setData({ loading: true, error: '', detail: null, pages: [], imageErrors: {} });
    if (!session) {
      this.setData({ loading: false, error: '请先登录后查看绘本。' });
      return;
    }
    try {
      const detail = assertPictureBookPreviewContext(await getPictureBook(id), id);
      if (version !== this.requestVersion || this.pageClosed || this.refreshAfterHide) return;
      if (consumerToken() !== session || id !== this.data.id) {
        this.setData({ error: '登录状态已变化，请重新读取绘本。' });
        return;
      }
      this.visibleSession = session;
      this.setData({
        detail,
        pages: buildPictureBookPreview(detail),
        imageErrors: {},
      });
    } catch {
      if (version !== this.requestVersion || this.pageClosed || this.refreshAfterHide) return;
      this.setData({
        detail: null,
        pages: [],
        error:
          consumerToken() === session
            ? '整书预览加载失败，请重试。'
            : '登录状态已变化，请重新读取绘本。',
      });
    } finally {
      if (version === this.requestVersion && !this.pageClosed && !this.refreshAfterHide)
        this.setData({ loading: false });
    }
  },
  retry() {
    void this.load();
  },
  async onImageError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    if (this.pageClosed || this.refreshAfterHide || !this.visibleSession) return;
    if (this.visibleSession !== consumerToken()) {
      this.visibleSession = '';
      this.setData({
        detail: null,
        pages: [],
        imageErrors: {},
        error: '登录状态已变化，请重新读取绘本。',
      });
      return;
    }
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
    const id = this.data.id;
    const session = this.visibleSession;
    const previousPages = this.data.pages;
    try {
      const detail = assertPictureBookPreviewContext(await getPictureBook(id), id);
      if (version !== this.requestVersion || this.pageClosed || this.refreshAfterHide) return;
      if (consumerToken() !== session || this.visibleSession !== session) {
        this.visibleSession = '';
        this.setData({
          detail: null,
          pages: [],
          imageErrors: {},
          error: '登录状态已变化，请重新读取绘本。',
        });
        return;
      }
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
