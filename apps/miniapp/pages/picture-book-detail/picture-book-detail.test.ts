import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import { getPictureBook, listCharacterReferences } from '../../services/picture-book';

vi.mock('../../services/picture-book', () => ({
  getPictureBook: vi.fn(),
  listCharacterReferences: vi.fn(),
}));

type DetailPage = {
  data: {
    id: string;
    detail: PictureBookDetail | null;
    references: Record<string, { playbackUrl: string | null }[]>;
    busy: boolean;
    polling: boolean;
    error: string;
    imageError: boolean;
    loading: boolean;
  };
  refreshAfterHide: boolean;
  pageClosed: boolean;
  loadRevision: number;
  pollingToken: number;
  setData: (changes: Record<string, unknown>) => void;
  load: () => Promise<void>;
  onHide: () => void;
  onShow: () => void;
  onUnload: () => void;
  onImageError: (event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) => void;
};

const readDetail = vi.mocked(getPictureBook);
const readReferences = vi.mocked(listCharacterReferences);
const oldUrl = 'https://private.invalid/cover.png?authorization=old-secret';
const newUrl = 'https://private.invalid/cover.png?authorization=new-secret';
let definition: DetailPage;

function book(url: string, withCharacter = true): PictureBookDetail {
  return {
    pictureBook: { title: '已保存的绘本' },
    characters: withCharacter
      ? [{ characterId: 'character-1', confirmed: true, locked: true }]
      : [],
    pages: [
      {
        id: 'page-1',
        illustrations: [{ playbackUrl: url }],
      },
    ],
  } as unknown as PictureBookDetail;
}

function instance(): DetailPage {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      id: 'owned-book',
      detail: null,
      references: {},
      busy: false,
      polling: false,
      imageError: false,
    },
    refreshAfterHide: false,
    pageClosed: false,
    loadRevision: 0,
    pollingToken: 0,
    setData(changes: Record<string, unknown>) {
      Object.assign(this.data, changes);
    },
  } as DetailPage;
  return page;
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: DetailPage) => {
    definition = options;
  });
  await import('./picture-book-detail');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

describe('picture-book detail owner-scoped media refresh (#189)', () => {
  it('does not duplicate initial load but re-reads detail and references after hide/show', async () => {
    readDetail.mockResolvedValueOnce(book(oldUrl)).mockResolvedValueOnce(book(newUrl));
    readReferences
      .mockResolvedValueOnce({ references: [{ playbackUrl: oldUrl }] } as never)
      .mockResolvedValueOnce({ references: [{ playbackUrl: newUrl }] } as never);
    const page = instance();
    await page.load();
    page.onShow();
    expect(readDetail).toHaveBeenCalledTimes(1);
    page.onImageError({ detail: { errMsg: oldUrl } } as never);
    page.onHide();
    page.onShow();
    await vi.waitFor(() =>
      expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(newUrl),
    );
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(readReferences).toHaveBeenCalledTimes(2);
    expect(page.data.imageError).toBe(false);
  });

  it('keeps pending refresh during busy or polling actions', async () => {
    readDetail.mockResolvedValue(book(oldUrl, false));
    const page = instance();
    await page.load();
    page.onHide();
    page.data.busy = true;
    page.onShow();
    expect(readDetail).toHaveBeenCalledTimes(1);
    page.data.busy = false;
    page.data.polling = true;
    page.onShow();
    expect(readDetail).toHaveBeenCalledTimes(1);
    page.data.polling = false;
    page.onShow();
    await vi.waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
  });

  it('never logs raw WeChat image errors or signed bearer URLs', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const page = instance();
    page.onImageError({ detail: { errMsg: newUrl } } as never);
    expect(page.data.imageError).toBe(true);
    expect(warning).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps the error visible if a refreshed owner GET returns an unchanged URL', async () => {
    readDetail.mockResolvedValue(book(oldUrl, false));
    const page = instance();
    await page.load();
    page.onImageError({ detail: { errMsg: oldUrl } } as never);
    page.onHide();
    page.onShow();
    await vi.waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    expect(page.data.imageError).toBe(true);
  });

  it('ignores older loads after a newer resume load succeeds', async () => {
    let resolveOld: (detail: PictureBookDetail) => void = () => {};
    readDetail
      .mockImplementationOnce(
        () =>
          new Promise<PictureBookDetail>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(book(newUrl, false));
    const page = instance();
    const oldLoad = page.load();
    page.onHide();
    page.onShow();
    await vi.waitFor(() =>
      expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(newUrl),
    );
    resolveOld(book(oldUrl, false));
    await oldLoad;
    expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(newUrl);
  });

  it('ignores pending owner reads after page unload', async () => {
    let resolveRead: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockImplementationOnce(
      () =>
        new Promise<PictureBookDetail>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const page = instance();
    const pending = page.load();
    page.onUnload();
    resolveRead(book(newUrl, false));
    await pending;
    expect(page.data.detail).toBeNull();
    expect(page.pageClosed).toBe(true);
  });
});
