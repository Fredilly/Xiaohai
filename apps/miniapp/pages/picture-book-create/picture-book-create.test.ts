import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPictureBook, PictureBookApiError } from '../../services/picture-book';

vi.mock('../../services/picture-book', () => ({
  createPictureBook: vi.fn(),
  PictureBookApiError: class PictureBookApiError extends Error {
    constructor(readonly status: number) {
      super(`Picture Book API ${status}`);
    }
  },
}));

type CreatePage = {
  data: {
    workId: string;
    versionId: string;
    title: string;
    submitting: boolean;
    creationUnknown: boolean;
    error: string;
  };
  setData(changes: Record<string, unknown>): void;
  submit(): Promise<void>;
  viewExisting(): void;
};

const create = vi.mocked(createPictureBook);
const redirectTo = vi.fn();
let definition: CreatePage;

function instance(): CreatePage {
  return {
    ...definition,
    data: {
      workId: 'story-1',
      versionId: 'body-1',
      title: '森林绘本',
      submitting: false,
      creationUnknown: false,
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

    expect(redirectTo).toHaveBeenCalledExactlyOnceWith({
      url: '/pages/picture-book-detail/picture-book-detail?id=created-book',
    });
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
});
