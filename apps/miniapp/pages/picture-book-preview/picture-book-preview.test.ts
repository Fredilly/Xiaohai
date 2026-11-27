import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import { getPictureBook } from '../../services/picture-book';
import { consumerToken } from '../../services/consumer-session';
import type { PictureBookPreviewPage } from '../../services/picture-book-preview';

vi.mock('../../services/picture-book', () => ({ getPictureBook: vi.fn() }));
vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));

type PreviewInstance = {
  data: {
    id: string;
    pages: PictureBookPreviewPage[];
    imageErrors: Record<string, boolean>;
    loading: boolean;
    detail: PictureBookDetail | null;
    error: string;
  };
  requestVersion: number;
  refreshAfterHide: boolean;
  pageClosed: boolean;
  visibleSession: string;
  imageRefreshInProgress: boolean;
  imageRefreshAttempted: Record<string, boolean>;
  setData: (changes: Record<string, unknown>) => void;
  load: () => Promise<void>;
  onHide: () => void;
  onShow: () => void;
  onUnload: () => void;
  onImageError: (event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) => Promise<void>;
};

let definition: PreviewInstance;
const read = vi.mocked(getPictureBook);
const token = vi.mocked(consumerToken);
const oldUrl = 'https://private.example.invalid/cover.png?signature=old-secret';
const newUrl = 'https://private.example.invalid/cover.png?signature=new-secret';

function detail(urls: string[]): PictureBookDetail {
  return {
    pictureBook: { id: 'owned-book', title: '测试绘本' },
    characters: [],
    pages: urls.map((url, index) => ({
      id: `page-${index + 1}`,
      pictureBookId: 'owned-book',
      pageKind: index === 0 ? 'COVER' : 'CONTENT',
      pageNumber: index,
      storyText: null,
      illustrations: [
        {
          id: `illustration-${index + 1}`,
          pageId: `page-${index + 1}`,
          revisionNumber: 1,
          status: 'READY',
          provider: 'BAILIAN',
          mediaAssetId: `asset-${index + 1}`,
          playbackUrl: url,
        },
      ],
    })),
  } as unknown as PictureBookDetail;
}

function instance(): PreviewInstance {
  const page = {
    ...definition,
    data: { ...definition.data, pages: [], imageErrors: {}, detail: null },
    requestVersion: 0,
    refreshAfterHide: false,
    pageClosed: false,
    visibleSession: '',
    imageRefreshInProgress: false,
    imageRefreshAttempted: {},
    setData(changes: Record<string, unknown>) {
      for (const [key, value] of Object.entries(changes)) {
        if (key.startsWith('imageErrors.')) {
          this.data.imageErrors[key.slice('imageErrors.'.length)] = Boolean(value);
        } else {
          (this.data as unknown as Record<string, unknown>)[key] = value;
        }
      }
    },
  } as PreviewInstance;
  page.data.id = 'owned-book';
  return page;
}

function imageError(pageId: string) {
  return { currentTarget: { dataset: { pageId } } } as unknown as WechatMiniprogram.CustomEvent<{
    errMsg?: string;
  }>;
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: PreviewInstance) => {
    definition = options;
  });
  await import('./picture-book-preview');
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.resetAllMocks());
beforeEach(() => token.mockReturnValue('session-a'));

describe('private BOS picture-book preview metadata refresh (#187)', () => {
  it('refreshes a failed image from the owner GET without regenerating', async () => {
    read.mockResolvedValueOnce(detail([oldUrl])).mockResolvedValueOnce(detail([newUrl]));
    const page = instance();
    await page.load();
    await page.onImageError(imageError('page-1'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(2, 'owned-book');
    expect(page.data.pages[0]?.imageUrl).toBe(newUrl);
    expect(page.data.imageErrors['page-1']).toBeUndefined();
  });

  it('fails closed when GET returns the same expired URL and does not loop', async () => {
    read.mockResolvedValue(detail([oldUrl]));
    const page = instance();
    await page.load();
    await page.onImageError(imageError('page-1'));
    await page.onImageError(imageError('page-1'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(page.data.imageErrors['page-1']).toBe(true);
  });

  it('coalesces concurrent image failures into one metadata GET', async () => {
    let release: (value: PictureBookDetail) => void = () => {};
    read.mockResolvedValueOnce(detail([oldUrl, oldUrl])).mockImplementationOnce(
      () =>
        new Promise<PictureBookDetail>((resolve) => {
          release = resolve;
        }),
    );
    const page = instance();
    await page.load();
    const first = page.onImageError(imageError('page-1'));
    const second = page.onImageError(imageError('page-2'));
    expect(read).toHaveBeenCalledTimes(2);
    release(detail([newUrl, newUrl]));
    await Promise.all([first, second]);
    expect(page.data.imageErrors).toEqual({});
    expect(page.data.pages.map((item) => item.imageUrl)).toEqual([newUrl, newUrl]);
  });

  it('reissues read-only metadata after returning from a hidden page', async () => {
    read.mockResolvedValueOnce(detail([oldUrl])).mockResolvedValueOnce(detail([newUrl]));
    const page = instance();
    await page.load();
    page.onShow();
    expect(read).toHaveBeenCalledTimes(1);
    page.onHide();
    expect(page.data.detail).toBeNull();
    expect(page.data.pages).toEqual([]);
    expect(page.visibleSession).toBe('');
    page.onShow();
    await vi.waitFor(() => expect(page.data.pages[0]?.imageUrl).toBe(newUrl));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the placeholder on network failures and ignores late unmounted results', async () => {
    read.mockResolvedValueOnce(detail([oldUrl])).mockRejectedValueOnce(new Error(oldUrl));
    const page = instance();
    await page.load();
    await page.onImageError(imageError('page-1'));
    expect(page.data.imageErrors['page-1']).toBe(true);
    expect(page.data.pages[0]?.imageUrl).toBe(oldUrl);
    expect(read).toHaveBeenCalledTimes(2);

    let release: (value: PictureBookDetail) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise<PictureBookDetail>((resolve) => {
          release = resolve;
        }),
    );
    page.onHide();
    page.onShow();
    page.onUnload();
    release(detail([newUrl]));
    await vi.waitFor(() => expect(page.imageRefreshInProgress).toBe(false));
    expect(page.data.pages).toEqual([]);
    expect(page.data.detail).toBeNull();
  });

  it('drops an old account GET response without rendering private signed media links', async () => {
    let release: (value: PictureBookDetail) => void = () => {};
    read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const page = instance();
    const pending = page.load();
    token.mockReturnValue('session-b');
    release(detail([oldUrl]));
    await pending;
    expect(page.data.pages).toEqual([]);
    expect(page.data.detail).toBeNull();
    expect(page.data.error).toContain('登录状态已变化');
  });

  it('rejects wrong book or nested illustration ownership before showing signed URLs', async () => {
    read.mockResolvedValueOnce({
      ...detail([oldUrl]),
      pictureBook: { ...detail([oldUrl]).pictureBook, id: 'another-book' },
    });
    const page = instance();
    await page.load();
    expect(page.data.pages).toEqual([]);
    expect(page.data.error).toContain('加载失败');

    const wrong = detail([newUrl]);
    wrong.pages[0]!.illustrations[0]!.pageId = 'different-page';
    read.mockResolvedValueOnce(wrong);
    await page.load();
    expect(page.data.pages).toEqual([]);
    expect(page.visibleSession).toBe('');
  });

  it('clears a signed preview if the account changes during image refresh', async () => {
    let release: (value: PictureBookDetail) => void = () => {};
    read
      .mockResolvedValueOnce(detail([oldUrl]))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const page = instance();
    await page.load();
    const refresh = page.onImageError(imageError('page-1'));
    token.mockReturnValue('session-b');
    release(detail([newUrl]));
    await refresh;
    expect(page.data.pages).toEqual([]);
    expect(page.data.detail).toBeNull();
    expect(page.visibleSession).toBe('');
    expect(page.data.error).toContain('登录状态已变化');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never starts a private detail read without an authenticated consumer session', async () => {
    token.mockReturnValue('');
    const page = instance();
    await page.load();
    expect(read).not.toHaveBeenCalled();
    expect(page.data.pages).toEqual([]);
    expect(page.data.error).toContain('请先登录');
  });
});
