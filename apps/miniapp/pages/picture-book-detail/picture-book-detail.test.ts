import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PictureBookDetail } from '@xiaohai/contracts/picture-book';
import { consumerToken } from '../../services/consumer-session';
import {
  applyPictureBookJob,
  generatePictureBookPlan,
  getPictureBookJob,
  generateCharacterReference,
  generateIllustration,
  getPictureBook,
  listCharacterReferences,
  PictureBookApiError,
} from '../../services/picture-book';

vi.mock('../../services/picture-book', () => ({
  generatePictureBookPlan: vi.fn(),
  getPictureBookJob: vi.fn(),
  applyPictureBookJob: vi.fn(),
  getPictureBook: vi.fn(),
  listCharacterReferences: vi.fn(),
  updatePictureBookCharacter: vi.fn(),
  generateCharacterReference: vi.fn(),
  generateIllustration: vi.fn(),
  PictureBookApiError: class PictureBookApiError extends Error {
    constructor(readonly status: number) {
      super(`Picture Book API ${status}`);
    }
  },
}));
vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));

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
    planNeedsReview: boolean;
    unsavedCharacterIds: Record<string, boolean>;
  };
  refreshAfterHide: boolean;
  pageClosed: boolean;
  loadRevision: number;
  pollingToken: number;
  planRevision: number;
  visibleSession: string;
  planNeedsReview: boolean;
  planPendingSession: string;
  planReviewSession: string;
  setData: (changes: Record<string, unknown>) => void;
  load: () => Promise<void>;
  onHide: () => void;
  onShow: () => void;
  onUnload: () => void;
  onImageError: (event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) => void;
  reference: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
  illustrate: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
  generatePlan: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
  editCharacterField: (event: WechatMiniprogram.TouchEvent) => void;
  saveCharacter: (event: WechatMiniprogram.TouchEvent) => Promise<void>;
};

const readDetail = vi.mocked(getPictureBook);
const readReferences = vi.mocked(listCharacterReferences);
const submitReference = vi.mocked(generateCharacterReference);
const submitIllustration = vi.mocked(generateIllustration);
const submitPlan = vi.mocked(generatePictureBookPlan);
const readJob = vi.mocked(getPictureBookJob);
const applyPlan = vi.mocked(applyPictureBookJob);
const token = vi.mocked(consumerToken);
const oldUrl = 'https://private.invalid/cover.png?authorization=old-secret';
const newUrl = 'https://private.invalid/cover.png?authorization=new-secret';
let definition: DetailPage;

function book(url: string, withCharacter = true): PictureBookDetail {
  return {
    pictureBook: { id: 'owned-book', title: '已保存的绘本' },
    characters: withCharacter
      ? [{ characterId: 'character-1', pictureBookId: 'owned-book', confirmed: true, locked: true }]
      : [],
    pages: [
      {
        id: 'page-1',
        pictureBookId: 'owned-book',
        illustrations: [{ id: 'illustration-1', pageId: 'page-1', playbackUrl: url }],
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
      detail: book(oldUrl),
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
    planRevision: 0,
    visibleSession: 'session-a',
    planNeedsReview: false,
    planPendingSession: '',
    planReviewSession: '',
    setData(changes: Record<string, unknown>) {
      Object.assign(this.data, changes);
    },
  } as DetailPage;
  return page;
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
beforeEach(() => token.mockReturnValue('session-a'));

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

  it('blocks a refresh while a character edit is unsaved', async () => {
    readDetail.mockResolvedValue(book(oldUrl));
    const page = instance();
    await page.load();
    page.data.detail!.characters[0]!.locked = false;
    page.editCharacterField({
      currentTarget: { dataset: { index: '0', field: 'name' } },
      detail: { value: '新名字' },
    } as never);
    expect(page.data.unsavedCharacterIds['character-1']).toBe(true);
    await page.load();
    expect(readDetail).toHaveBeenCalledTimes(1);
    expect(page.data.error).toContain('尚未保存');
  });

  it('refreshes private content on return even if a prior action was busy', async () => {
    readDetail.mockResolvedValue(book(oldUrl, false));
    const page = instance();
    await page.load();
    page.onHide();
    page.data.busy = true;
    page.onShow();
    await vi.waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    expect(page.data.busy).toBe(false);
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

  it('clears stale image errors and bearer links when returning from a hidden page', async () => {
    readDetail.mockResolvedValue(book(oldUrl, false));
    const page = instance();
    await page.load();
    page.onImageError({ detail: { errMsg: oldUrl } } as never);
    page.onHide();
    page.onShow();
    await vi.waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    expect(page.data.imageError).toBe(false);
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

  it('clears private media on hide and does not republish a late prior-account read', async () => {
    let release: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const page = instance();
    const pending = page.load();
    page.onHide();
    expect(page.data.detail).toBeNull();
    expect(page.data.references).toEqual({});
    token.mockReturnValue('session-b');
    release(book(newUrl));
    await pending;
    expect(page.data.detail).toBeNull();
    expect(page.visibleSession).toBe('');
  });

  it('rejects a wrong book and an illustration associated with another page', async () => {
    readDetail.mockResolvedValueOnce({
      ...book(oldUrl, false),
      pictureBook: { ...book(oldUrl, false).pictureBook, id: 'foreign-book' },
    });
    const page = instance();
    await page.load();
    expect(page.data.detail).toBeNull();
    expect(page.data.error).toBe('绘本加载失败');

    const invalid = book(newUrl, false);
    invalid.pages[0]!.illustrations[0]!.pageId = 'another-page';
    readDetail.mockResolvedValueOnce(invalid);
    await page.load();
    expect(page.data.detail).toBeNull();
    expect(page.visibleSession).toBe('');
  });

  it('does not show signed media returned by a former account request', async () => {
    let release: (detail: PictureBookDetail) => void = () => {};
    readDetail.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const page = instance();
    const pending = page.load();
    token.mockReturnValue('session-b');
    release(book(oldUrl));
    await pending;
    expect(page.data.detail).toBeNull();
    expect(page.data.error).toContain('登录状态已变化');
    expect(page.visibleSession).toBe('');
  });
});

describe('picture-book background image job recovery (#112)', () => {
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
              pageId: 'page-1',
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

  it('preserves an accepted planning job after hiding but never restores the hidden book', async () => {
    submitPlan.mockResolvedValue({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'QUEUED',
    });
    readJob.mockResolvedValue({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'SUCCEEDED',
    } as never);
    let apply: (detail: PictureBookDetail) => void = () => {};
    applyPlan.mockImplementationOnce(() => new Promise((resolve) => (apply = resolve)));
    const page = instance();
    const pending = page.generatePlan(touch({ operation: 'STORYBOARD' }));
    await vi.waitFor(() => expect(applyPlan).toHaveBeenCalledOnce());
    page.onHide();
    apply(book(newUrl));
    await pending;
    expect(applyPlan).toHaveBeenCalledWith('owned-book', 'job-1');
    expect(page.data.detail).toBeNull();
    expect(page.data.busy).toBe(false);
  });

  it('rejects an accepted planning job belonging to another book before polling', async () => {
    submitPlan.mockResolvedValue({
      pictureBookId: 'foreign-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'QUEUED',
    });
    const page = instance();
    await page.generatePlan(touch({ operation: 'STORYBOARD' }));
    expect(readJob).not.toHaveBeenCalled();
    expect(applyPlan).not.toHaveBeenCalled();
    expect(page.data.error).toContain('勿重复提交');
    expect(page.data.planNeedsReview).toBe(true);
  });

  it('does not start a second paid planning job when the first result is uncertain', async () => {
    submitPlan.mockResolvedValue({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'QUEUED',
    });
    readJob.mockRejectedValueOnce(new Error('network:timeout'));
    const page = instance();
    await page.generatePlan(touch({ operation: 'STORYBOARD' }));
    expect(page.data.planNeedsReview).toBe(true);
    expect(page.data.error).toContain('勿重复提交');
    await page.generatePlan(touch({ operation: 'STORYBOARD' }));
    expect(submitPlan).toHaveBeenCalledOnce();
    readDetail.mockResolvedValueOnce(book(newUrl, false));
    await page.load();
    expect(page.data.planNeedsReview).toBe(true);
    expect(page.data.error).toContain('勿重复提交');
  });

  it('continues one accepted planning job after hide/show without starting a second', async () => {
    submitPlan.mockResolvedValue({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'QUEUED',
    });
    let finish: (status: Awaited<ReturnType<typeof getPictureBookJob>>) => void = () => {};
    readJob.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    applyPlan.mockResolvedValue(book(newUrl));
    readDetail.mockResolvedValue(book(oldUrl));
    readReferences.mockResolvedValue({ references: [] });
    const page = instance();
    const pending = page.generatePlan(touch({ operation: 'STORYBOARD' }));
    await vi.waitFor(() => expect(readJob).toHaveBeenCalledOnce());
    page.onHide();
    page.onShow();
    await vi.waitFor(() => expect(page.visibleSession).toBe('session-a'));
    await page.generatePlan(touch({ operation: 'STORYBOARD' }));
    expect(submitPlan).toHaveBeenCalledOnce();
    finish({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'SUCCEEDED',
    } as never);
    await pending;
    expect(applyPlan).toHaveBeenCalledOnce();
    expect(page.data.detail?.pages[0]?.illustrations[0]?.playbackUrl).toBe(newUrl);
  });

  it('never applies a completed planning job after the user switches accounts', async () => {
    submitPlan.mockResolvedValue({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'QUEUED',
    });
    let finish: (status: Awaited<ReturnType<typeof getPictureBookJob>>) => void = () => {};
    readJob.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const page = instance();
    const pending = page.generatePlan(touch({ operation: 'STORYBOARD' }));
    await vi.waitFor(() => expect(readJob).toHaveBeenCalledOnce());
    token.mockReturnValue('session-b');
    finish({
      pictureBookId: 'owned-book',
      jobId: 'job-1',
      operation: 'STORYBOARD',
      status: 'SUCCEEDED',
    } as never);
    await pending;
    expect(applyPlan).not.toHaveBeenCalled();
    expect(page.data.detail).toBeNull();
    expect(page.visibleSession).toBe('');
  });

  it('does not start new paid image jobs after the page has hidden its private data', async () => {
    const page = instance();
    page.onHide();
    await page.illustrate(touch({ pageId: 'page-1' }));
    await page.reference(touch({ characterId: 'character-1' }));
    expect(submitIllustration).not.toHaveBeenCalled();
    expect(submitReference).not.toHaveBeenCalled();
  });

  it('stops paid-image polling after a session switch and clears the prior book', async () => {
    let accepted: (value: Awaited<ReturnType<typeof generateIllustration>>) => void = () => {};
    submitIllustration.mockImplementationOnce(() => new Promise((resolve) => (accepted = resolve)));
    const page = instance();
    const pending = page.illustrate(touch({ pageId: 'page-1' }));
    token.mockReturnValue('session-b');
    accepted({
      pictureBookId: 'owned-book',
      pageId: 'page-1',
      illustrationId: 'revision-1',
      revisionNumber: 1,
      status: 'QUEUED',
    });
    await pending;
    expect(submitIllustration).toHaveBeenCalledOnce();
    expect(readDetail).not.toHaveBeenCalled();
    expect(page.data.detail).toBeNull();
    expect(page.visibleSession).toBe('');
  });
});
