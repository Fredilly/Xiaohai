import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPictureBook, PictureBookApiError } from '../../services/picture-book';
import { consumerToken } from '../../services/consumer-session';

vi.mock('../../services/picture-book', () => ({
  createPictureBook: vi.fn(),
  PictureBookApiError: class PictureBookApiError extends Error {
    constructor(readonly status: number) {
      super(`Picture Book API ${status}`);
    }
  },
}));
vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));

type CreatePage = {
  sourceSession: string;
  wasHidden: boolean;
  pageClosed: boolean;
  navigating: boolean;
  data: {
    workId: string;
    versionId: string;
    title: string;
    submitting: boolean;
    creationUnknown: boolean;
    createdId: string;
    error: string;
  };
  setData(changes: Record<string, unknown>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  submit(): Promise<void>;
  viewExisting(): void;
};

const create = vi.mocked(createPictureBook);
const token = vi.mocked(consumerToken);
const redirectTo = vi.fn();
let definition: CreatePage;

function instance(): CreatePage {
  return {
    ...definition,
    sourceSession: 'session-a',
    wasHidden: false,
    pageClosed: false,
    navigating: false,
    data: {
      workId: 'story-1',
      versionId: 'body-1',
      title: '森林绘本',
      submitting: false,
      creationUnknown: false,
      createdId: '',
      error: '',
    },
    setData(changes: Record<string, unknown>) {
      Object.assign(this.data, changes);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: CreatePage) => {
    definition = options;
  });
  vi.stubGlobal('wx', { redirectTo });
  await import('./picture-book-create');
});
afterEach(() => vi.resetAllMocks());
beforeEach(() => token.mockReturnValue('session-a'));
afterAll(() => vi.unstubAllGlobals());

describe('picture-book creation is single-flight and ambiguous responses are safe (#112)', () => {
  it('submits only once for concurrent taps and navigates to the created book', async () => {
    let complete: (value: Awaited<ReturnType<typeof createPictureBook>>) => void = () => {};
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const page = instance();

    const first = page.submit();
    const second = page.submit();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      storyWorkId: 'story-1',
      sourceStoryVersionId: 'body-1',
      title: '森林绘本',
    });
    complete({ id: 'created-book' } as Awaited<ReturnType<typeof createPictureBook>>);
    await Promise.all([first, second]);

    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: '/pages/picture-book-detail/picture-book-detail?id=created-book',
      }),
    );
    expect(page.data.submitting).toBe(false);
  });

  it('stops blind retries when a network timeout leaves creation status unknown', async () => {
    create.mockRejectedValueOnce(new Error('request:fail timeout'));
    const page = instance();

    await page.submit();
    await page.submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(page.data.creationUnknown).toBe(true);
    expect(page.data.error).toContain('避免重复创建');
    page.viewExisting();
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith({
      url: '/pages/picture-books/picture-books',
    });
  });

  it('keeps explicit feature-disable and invalid-source errors distinct from unknown outcomes', async () => {
    const page = instance();
    create.mockRejectedValueOnce(new PictureBookApiError(503));
    await page.submit();
    expect(page.data.error).toBe('绘本功能尚未开启');
    expect(page.data.creationUnknown).toBe(false);

    create.mockRejectedValueOnce(new PictureBookApiError(409));
    await page.submit();
    expect(page.data.error).toBe('创建失败，请确认正文版本仍然有效。');
    expect(page.data.creationUnknown).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('treats a server error after submission as an unknown result, not proof of failure', async () => {
    create.mockRejectedValueOnce(new PictureBookApiError(500));
    const page = instance();
    await page.submit();
    expect(page.data.creationUnknown).toBe(true);
    expect(page.data.error).toContain('我的绘本');
  });

  it('retains a successful hidden creation and navigates on return without reposting', async () => {
    let complete: (value: Awaited<ReturnType<typeof createPictureBook>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const page = instance();
    const pending = page.submit();
    page.onHide();
    complete({ id: 'created-book' } as Awaited<ReturnType<typeof createPictureBook>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(page.data.createdId).toBe('created-book');
    await page.submit();
    expect(create).toHaveBeenCalledOnce();
    page.onShow();
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: '/pages/picture-book-detail/picture-book-detail?id=created-book',
      }),
    );
  });

  it('discards a prior-account result instead of opening the other account book', async () => {
    let complete: (value: Awaited<ReturnType<typeof createPictureBook>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const page = instance();
    const pending = page.submit();
    token.mockReturnValue('session-b');
    complete({ id: 'created-book' } as Awaited<ReturnType<typeof createPictureBook>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(page.data.workId).toBe('');
    expect(page.data.versionId).toBe('');
    expect(page.data.createdId).toBe('');
    expect(page.data.error).toContain('登录状态已变化');
    await page.submit();
    expect(create).toHaveBeenCalledOnce();
  });

  it('invalidates an old source when resuming under a different account', async () => {
    const page = instance();
    page.onHide();
    token.mockReturnValue('session-b');
    page.onShow();
    expect(page.data.workId).toBe('');
    expect(page.data.versionId).toBe('');
    expect(page.data.title).toBe('');
    expect(page.data.error).toContain('登录状态已变化');
    await page.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not redirect or write to the disposed page after a submitted request settles', async () => {
    let complete: (value: Awaited<ReturnType<typeof createPictureBook>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const page = instance();
    const pending = page.submit();
    page.onUnload();
    complete({ id: 'created-book' } as Awaited<ReturnType<typeof createPictureBook>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(page.data.createdId).toBe('');
    expect(create).toHaveBeenCalledOnce();
  });
});
