import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PictureBookApiError } from '../../services/picture-book';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listPictureBooks: vi.fn(),
  switchTab: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/picture-book', () => ({
  PictureBookApiError: class PictureBookApiError extends Error {
    constructor(readonly status: number) {
      super(`Picture Book API ${status}`);
    }
  },
  listPictureBooks: mocks.listPictureBooks,
}));

type TestState = {
  books: Array<{ id: string; coverPlaybackUrl?: string | null }>;
  imageErrors: Record<string, boolean>;
  loading: boolean;
  error: string;
  needsLogin: boolean;
};

type TestPage = {
  data: TestState;
  requestVersion: number;
  pageClosed: boolean;
  setData(changes: Partial<TestState>): void;
  load(): Promise<void>;
  onUnload(): void;
  goToLogin(): void;
};

let definition: Pick<TestPage, 'load' | 'onUnload' | 'goToLogin'>;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./picture-books');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function createPage(): TestPage {
  const page: TestPage = {
    data: { books: [], imageErrors: {}, loading: true, error: '', needsLogin: false },
    requestVersion: 0,
    pageClosed: false,
    setData(changes) {
      Object.assign(page.data, changes);
    },
    load() {
      return definition.load.call(page);
    },
    onUnload() {
      definition.onUnload.call(page);
    },
    goToLogin() {
      definition.goToLogin.call(page);
    },
  };
  return page;
}

describe('picture books: login-required state', () => {
  it('skips the protected list API and navigates to Me when signed out', async () => {
    mocks.token.mockReturnValue('');
    const page = createPage();
    page.data.books = [{ id: 'previous-book' }];
    page.data.imageErrors = { 'previous-book': true };

    await page.load();

    expect(mocks.listPictureBooks).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({
      books: [],
      imageErrors: {},
      loading: false,
      error: '',
      needsLogin: true,
    });
    page.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('loads the original personal picture-book list with a valid token', async () => {
    mocks.token.mockReturnValue('valid-session');
    const pictureBooks = [{ id: 'book-1' }];
    mocks.listPictureBooks.mockResolvedValue({ pictureBooks });
    const page = createPage();
    page.data.needsLogin = true;

    await page.load();

    expect(mocks.listPictureBooks).toHaveBeenCalledOnce();
    expect(page.data).toMatchObject({
      books: pictureBooks,
      loading: false,
      error: '',
      needsLogin: false,
    });
  });

  it('shows the login-required state when the server rejects an expired session', async () => {
    mocks.token.mockReturnValue('expired-token');
    mocks.listPictureBooks.mockRejectedValue(new PictureBookApiError(401));
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({
      books: [],
      loading: false,
      error: '',
      needsLogin: true,
    });
  });

  it('keeps non-auth/network failures retryable rather than claiming the user is signed out', async () => {
    mocks.token.mockReturnValue('valid-session');
    mocks.listPictureBooks.mockRejectedValue(new Error('request:fail timeout'));
    const page = createPage();

    await page.load();

    expect(page.data.needsLogin).toBe(false);
    expect(page.data.loading).toBe(false);
    expect(page.data.error).toBe('绘本加载失败，请检查网络后重试。');
  });

  it('ignores stale list responses so a slow expired BOS cover cannot replace a fresh one', async () => {
    mocks.token.mockReturnValue('valid-session');
    let resolveOld: (value: { pictureBooks: TestState['books'] }) => void = () => {};
    mocks.listPictureBooks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        pictureBooks: [{ id: 'book-1', coverPlaybackUrl: 'https://bos.invalid/cover?sig=fresh' }],
      });
    const page = createPage();

    const oldLoad = page.load();
    await page.load();
    resolveOld({
      pictureBooks: [{ id: 'book-1', coverPlaybackUrl: 'https://bos.invalid/cover?sig=expired' }],
    });
    await oldLoad;

    expect(page.data.books[0]?.coverPlaybackUrl).toContain('sig=fresh');
    expect(page.data.loading).toBe(false);
    expect(mocks.listPictureBooks).toHaveBeenCalledTimes(2);
  });

  it('keeps the signed-out state if an older authorized list request finishes later', async () => {
    mocks.token.mockReturnValueOnce('previous-session').mockReturnValueOnce('');
    let resolveOld: (value: { pictureBooks: TestState['books'] }) => void = () => {};
    mocks.listPictureBooks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const page = createPage();

    const oldLoad = page.load();
    await page.load();
    resolveOld({ pictureBooks: [{ id: 'private-book' }] });
    await oldLoad;

    expect(page.data.books).toEqual([]);
    expect(page.data.needsLogin).toBe(true);
    expect(page.data.loading).toBe(false);
    expect(mocks.listPictureBooks).toHaveBeenCalledTimes(1);
  });

  it('does not write a late list response after the page has unloaded', async () => {
    mocks.token.mockReturnValue('valid-session');
    let resolveRead: (value: { pictureBooks: TestState['books'] }) => void = () => {};
    mocks.listPictureBooks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const page = createPage();

    const pending = page.load();
    page.onUnload();
    resolveRead({ pictureBooks: [{ id: 'unmounted-book' }] });
    await pending;

    expect(page.pageClosed).toBe(true);
    expect(page.data.books).toEqual([]);
    expect(page.requestVersion).toBe(2);
  });
});
