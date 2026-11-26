import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import {
  generateCharacterReference,
  generateIllustration,
  getPictureBook,
  listCharacterReferences,
  PictureBookApiError,
  updatePictureBookCharacter,
} from '../../services/picture-book';

vi.mock('../../services/picture-book', () => ({
  getPictureBook: vi.fn(),
  listCharacterReferences: vi.fn(),
  generateCharacterReference: vi.fn(),
  generateIllustration: vi.fn(),
  updatePictureBookCharacter: vi.fn(),
  PictureBookApiError: class PictureBookApiError extends Error {
    constructor(readonly status: number) {
      super(`Picture Book API ${status}`);
    }
  },
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
    unsavedCharacterIds: Record<string, boolean>;
  };
  refreshAfterHide: boolean;
  pageClosed: boolean;
  loadRevision: number;
  pollingToken: number;
  setData: (changes: Record<string, unknown>) => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  editCharacterField: (event: {
    currentTarget: { dataset: Record<string, string> };
    detail: { value: string };
  }) => void;
  saveCharacter: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
  onHide: () => void;
  onShow: () => void;
  onUnload: () => void;
  onImageError: (event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) => void;
  reference: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
  illustrate: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
};

const readDetail = vi.mocked(getPictureBook);
const readReferences = vi.mocked(listCharacterReferences);
const submitReference = vi.mocked(generateCharacterReference);
const submitIllustration = vi.mocked(generateIllustration);
const saveCharacter = vi.mocked(updatePictureBookCharacter);
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
      unsavedCharacterIds: {},
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

function editableBook(name = '旧角色名'): PictureBookDetail {
  const original = book(oldUrl);
  return {
    ...original,
    characters: [
      {
        ...original.characters[0]!,
        name,
        description: '简介',
        canonicalVisualPrompt: '外观',
        locked: false,
      },
    ],
  };
}

function touch(dataset: Record<string, string>) {
  return { currentTarget: { dataset } } as unknown as WechatMiniprogram.TouchEvent;
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
  it('blocks refresh while character edits are unsaved, without issuing another GET', async () => {
    readDetail.mockResolvedValue(editableBook());
    readReferences.mockResolvedValue({ references: [] });
    const page = instance();
    await page.load();
    page.editCharacterField({
      currentTarget: { dataset: { index: '0', field: 'name' } },
      detail: { value: '本地未保存的新角色' },
    });

    await page.refresh();

    expect(readDetail).toHaveBeenCalledTimes(1);
    expect(page.data.detail?.characters[0]?.name).toBe('本地未保存的新角色');
    expect(page.data.error).toContain('尚未保存');
    expect(page.data.busy).toBe(false);
  });

  it('holds mutation controls while manual refresh is reading and prevents stale updates after saving', async () => {
    const initial = editableBook();
    let releaseRead: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockResolvedValueOnce(initial).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRead = resolve;
        }),
    );
    readReferences.mockResolvedValue({ references: [] });
    saveCharacter.mockResolvedValue(editableBook('已保存的新角色'));
    const page = instance();
    await page.load();
    const pending = page.refresh();
    expect(page.data.busy).toBe(true);
    await page.saveCharacter(touch({ index: '0' }));
    expect(saveCharacter).not.toHaveBeenCalled();
    releaseRead(initial);
    await pending;
    expect(page.data.busy).toBe(false);

    page.editCharacterField({
      currentTarget: { dataset: { index: '0', field: 'name' } },
      detail: { value: '已保存的新角色' },
    });
    await page.saveCharacter(touch({ index: '0' }));
    expect(saveCharacter).toHaveBeenCalledTimes(1);
    expect(page.data.detail?.characters[0]?.name).toBe('已保存的新角色');
    expect(page.data.unsavedCharacterIds['character-1']).toBe(false);
  });

  it('invalidates a pending owner GET when a character is edited', async () => {
    let releaseRead: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRead = resolve;
        }),
    );
    const page = instance();
    page.data.detail = editableBook();
    const pending = page.load();
    page.editCharacterField({
      currentTarget: { dataset: { index: '0', field: 'name' } },
      detail: { value: '写到一半' },
    });
    releaseRead(editableBook('过期远端版本'));
    await pending;
    expect(page.data.detail?.characters[0]?.name).toBe('写到一半');
  });

  it('never overwrites a newer save with an older owner GET', async () => {
    let releaseRead: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRead = resolve;
        }),
    );
    saveCharacter.mockResolvedValueOnce(editableBook('服务器已保存的新名字'));
    const page = instance();
    page.data.detail = editableBook('本地原始名字');
    const pending = page.load();
    await page.saveCharacter(touch({ index: '0' }));
    releaseRead(editableBook('旧 GET 快照'));
    await pending;

    expect(page.data.detail?.characters[0]?.name).toBe('服务器已保存的新名字');
    expect(readReferences).not.toHaveBeenCalled();
  });

  it('never overwrites a completed illustration with an older owner GET', async () => {
    let releaseRead: (detail: PictureBookDetail) => void = () => {};
    readDetail
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRead = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...book(newUrl, false),
        pages: [
          {
            ...book(newUrl, false).pages[0]!,
            illustrations: [{ id: 'revision-new', status: 'READY', playbackUrl: newUrl }],
          },
        ],
      } as PictureBookDetail);
    submitIllustration.mockResolvedValueOnce({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-new',
      revisionNumber: 1,
      status: 'QUEUED',
    });
    const page = instance();
    page.data.detail = book(oldUrl);
    const pending = page.load();
    await page.illustrate(touch({ pageId: 'page-1' }));
    releaseRead(book(oldUrl, false));
    await pending;

    expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(newUrl);
    expect(readReferences).not.toHaveBeenCalled();
    expect(submitIllustration).toHaveBeenCalledTimes(1);
  });

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

describe('picture-book background image job recovery (#112)', () => {
  it.each([401, 403])(
    'clears private book and references on denied illustration polling (%i)',
    async (status) => {
      submitIllustration.mockResolvedValueOnce({
        pictureBookId: 'owned-book',
        pageId: 'page-1',
        illustrationId: 'revision-1',
        revisionNumber: 1,
        status: 'QUEUED',
      });
      readDetail.mockRejectedValueOnce(new PictureBookApiError(status));
      const page = instance();
      page.data.detail = book(oldUrl);
      page.data.references = { 'character-1': [{ playbackUrl: oldUrl }] };
      await page.illustrate(touch({ pageId: 'page-1' }));
      expect(page.data.detail).toBeNull();
      expect(page.data.references).toEqual({});
      expect(page.data.error).toContain('登录状态已失效');
      expect(page.data.busy).toBe(false);
      expect(page.data.polling).toBe(false);
    },
  );

  it.each([401, 403])(
    'clears private book and references on denied reference polling (%i)',
    async (status) => {
      submitReference.mockResolvedValueOnce({
        pictureBookId: 'owned-book',
        characterId: 'character-1',
        referenceRevisionId: 'reference-1',
        revisionNumber: 1,
        status: 'QUEUED',
      });
      readReferences.mockRejectedValueOnce(new PictureBookApiError(status));
      const page = instance();
      page.data.detail = book(oldUrl);
      page.data.references = { 'character-1': [{ playbackUrl: oldUrl }] };
      await page.reference(touch({ characterId: 'character-1' }));
      expect(page.data.detail).toBeNull();
      expect(page.data.references).toEqual({});
      expect(page.data.error).toContain('登录状态已失效');
      expect(page.data.busy).toBe(false);
      expect(page.data.polling).toBe(false);
    },
  );

  it('reports an illustration polling timeout without submitting another paid job', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(620_001);
    submitIllustration.mockResolvedValue({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-1',
      revisionNumber: 1,
      status: 'QUEUED',
    });
    const page = instance();

    await page.illustrate(touch({ pageId: 'page-1', regenerate: 'false' }));

    expect(submitIllustration).toHaveBeenCalledExactlyOnceWith('owned-book', 'page-1', false);
    expect(readDetail).not.toHaveBeenCalled();
    expect(page.data.error).toContain('仍在后台处理中');
    expect(page.data.busy).toBe(false);
    expect(page.data.polling).toBe(false);

    readDetail.mockResolvedValueOnce(book(oldUrl, false));
    await page.load(); // The visible refresh button uses this owner-scoped read only.
    expect(page.data.error).toBe('');
    expect(readDetail).toHaveBeenCalledExactlyOnceWith('owned-book');
    expect(submitIllustration).toHaveBeenCalledTimes(1);
  });

  it('shows failed revision status without automatically regenerating a page', async () => {
    submitIllustration.mockResolvedValue({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-2',
      revisionNumber: 2,
      status: 'QUEUED',
    });
    readDetail.mockResolvedValueOnce({
      ...book(oldUrl, false),
      pages: [
        {
          ...book(oldUrl, false).pages[0]!,
          illustrations: [
            {
              id: 'revision-2',
              status: 'FAILED',
              errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
            },
          ],
        },
      ],
    } as PictureBookDetail);
    const page = instance();

    await page.illustrate(touch({ pageId: 'page-1', regenerate: 'true' }));

    expect(submitIllustration).toHaveBeenCalledExactlyOnceWith('owned-book', 'page-1', true);
    expect(readDetail).toHaveBeenCalledTimes(1);
    expect(page.data.error).toBe('插画生成失败（IMAGE_PROVIDER_UNAVAILABLE）');
    expect(page.data.polling).toBe(false);
  });

  it('distinguishes a blocked submission from an accepted job with a failed status read', async () => {
    submitIllustration.mockRejectedValueOnce(new PictureBookApiError(503));
    const blocked = instance();
    await blocked.illustrate(touch({ pageId: 'page-1' }));
    expect(blocked.data.error).toBe('图片生成未开启（安全关闭）');
    expect(readDetail).not.toHaveBeenCalled();

    submitIllustration.mockResolvedValueOnce({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-2',
      revisionNumber: 2,
      status: 'QUEUED',
    });
    readDetail.mockRejectedValueOnce(new PictureBookApiError(503));
    const accepted = instance();
    await accepted.illustrate(touch({ pageId: 'page-1', regenerate: 'true' }));
    expect(accepted.data.error).toBe('插画状态查询失败，请稍后查看任务结果。');
    expect(submitIllustration).toHaveBeenCalledTimes(2);
    expect(readDetail).toHaveBeenCalledTimes(1);
  });

  it('reports reference-image polling timeout without resubmitting the job', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(620_001);
    submitReference.mockResolvedValue({
      pictureBookId: 'owned-book',
      characterId: 'character-1',
      referenceRevisionId: 'reference-1',
      revisionNumber: 1,
      status: 'QUEUED',
    });
    const page = instance();

    await page.reference(touch({ characterId: 'character-1' }));

    expect(submitReference).toHaveBeenCalledExactlyOnceWith('owned-book', 'character-1');
    expect(readReferences).not.toHaveBeenCalled();
    expect(page.data.error).toContain('仍在后台处理中');
    expect(page.data.busy).toBe(false);
    expect(page.data.polling).toBe(false);
  });

  it('discards an accepted image job after page unload without polling or resubmitting', async () => {
    let accept: (value: Awaited<ReturnType<typeof generateIllustration>>) => void = () => {};
    submitIllustration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const page = instance();
    const pending = page.illustrate(touch({ pageId: 'page-1', regenerate: 'false' }));
    page.onUnload();
    accept({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-1',
      revisionNumber: 1,
      status: 'QUEUED',
    });
    await pending;

    expect(submitIllustration).toHaveBeenCalledTimes(1);
    expect(readDetail).not.toHaveBeenCalled();
    expect(page.data.error).toBe('');
    expect(page.data.polling).toBe(false);
    expect(page.pageClosed).toBe(true);
  });

  it('keeps the saved book available when only reference thumbnails fail to load', async () => {
    readDetail.mockResolvedValue(book(oldUrl));
    readReferences
      .mockResolvedValueOnce({ references: [{ playbackUrl: oldUrl }] } as never)
      .mockRejectedValueOnce(new Error('network:timeout'));
    const page = instance();
    await page.load();
    page.onImageError({ detail: { errMsg: oldUrl } } as never);

    await page.load();

    expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(oldUrl);
    expect(page.data.references['character-1']).toEqual([]);
    expect(page.data.error).toContain('部分角色参考图未加载');
    expect(page.data.loading).toBe(false);
    expect(page.data.imageError).toBe(true);
    expect(submitReference).not.toHaveBeenCalled();
    expect(submitIllustration).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'hides an already opened book when reference access is denied (%i)',
    async (status) => {
      readDetail.mockResolvedValue(book(oldUrl));
      readReferences
        .mockResolvedValueOnce({ references: [{ playbackUrl: oldUrl }] } as never)
        .mockRejectedValueOnce(new PictureBookApiError(status));
      const page = instance();
      await page.load();
      expect(page.data.detail).not.toBeNull();

      await page.load();

      expect(page.data.detail).toBeNull();
      expect(page.data.references).toEqual({});
      expect(page.data.error).toContain('登录状态已失效');
    },
  );
});
