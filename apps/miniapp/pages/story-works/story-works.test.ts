import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryApiError } from '../../services/story';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listStoryWorks: vi.fn(),
  switchTab: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/story', () => ({
  StoryApiError: class StoryApiError extends Error {
    constructor(readonly status: number) {
      super(`Story API ${status}`);
    }
  },
  listStoryWorks: mocks.listStoryWorks,
}));

type State = {
  works: Array<{ id: string }>;
  loading: boolean;
  error: boolean;
  needsLogin: boolean;
};
type TestPage = {
  readSequence: number;
  wasHidden: boolean;
  loadedSession: string;
  data: State;
  setData(changes: Partial<State>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  goToLogin(): void;
  openWork(event: WechatMiniprogram.TouchEvent): void;
};

let definition: TestPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./story-works');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab, navigateTo: mocks.navigateTo });
});

function createPage(): TestPage {
  const page: TestPage = {
    ...definition,
    readSequence: 0,
    wasHidden: false,
    loadedSession: '',
    data: { works: [], loading: true, error: false, needsLogin: false },
    setData(changes) {
      Object.assign(page.data, changes);
    },
  };
  return page;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('AI story works: protected list states', () => {
  it('skips the protected API and shows a login action while signed out', async () => {
    mocks.token.mockReturnValue('');
    const page = createPage();

    await page.load();

    expect(mocks.listStoryWorks).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ loading: false, error: false, needsLogin: true });
    page.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('loads works when a session exists', async () => {
    mocks.token.mockReturnValue('valid-token');
    const works = [{ id: 'work-1' }];
    mocks.listStoryWorks.mockResolvedValue({ works });
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({ works, loading: false, error: false, needsLogin: false });
  });

  it('shows login-required after a 401 instead of a network error', async () => {
    mocks.token.mockReturnValue('expired-token');
    mocks.listStoryWorks.mockRejectedValue(new StoryApiError(401));
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({
      works: [],
      loading: false,
      error: false,
      needsLogin: true,
    });
  });

  it('preserves retryable errors for a network failure', async () => {
    mocks.token.mockReturnValue('valid-token');
    mocks.listStoryWorks.mockRejectedValue(new Error('request:fail timeout'));
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({ loading: false, error: true, needsLogin: false });
  });

  it('discards a previous account read when a newer account finishes first', async () => {
    const old = deferred<{ works: State['works'] }>();
    mocks.token.mockReturnValue('session-A');
    mocks.listStoryWorks.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      works: [{ id: 'new-work' }],
    });
    const page = createPage();
    const first = page.load();
    mocks.token.mockReturnValue('session-B');
    await page.load();
    old.resolve({ works: [{ id: 'old-private-work' }] });
    await first;

    expect(page.data.works).toEqual([{ id: 'new-work' }]);
    expect(page.loadedSession).toBe('session-B');
  });

  it('retries with the current account when it changes during the only pending read', async () => {
    const old = deferred<{ works: State['works'] }>();
    mocks.token.mockReturnValue('session-A');
    mocks.listStoryWorks.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      works: [{ id: 'new-work' }],
    });
    const page = createPage();
    const first = page.load();
    mocks.token.mockReturnValue('session-B');
    old.resolve({ works: [{ id: 'old-private-work' }] });
    await first;
    await vi.waitFor(() => expect(page.data.works).toEqual([{ id: 'new-work' }]));

    expect(mocks.listStoryWorks).toHaveBeenCalledTimes(2);
  });

  it('clears private works on hide and ignores a late response or error', async () => {
    const old = deferred<{ works: State['works'] }>();
    mocks.token.mockReturnValue('valid-token');
    mocks.listStoryWorks.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      works: [{ id: 'visible-work' }],
    });
    const page = createPage();
    const first = page.load();
    page.onHide();
    old.resolve({ works: [{ id: 'stale-work' }] });
    await first;
    expect(page.data.works).toEqual([]);
    page.onShow();
    await vi.waitFor(() => expect(page.data.works).toEqual([{ id: 'visible-work' }]));
    page.onUnload();
    expect(page.wasHidden).toBe(true);
    expect(page.loadedSession).toBe('');
  });

  it('blocks navigation to a previous account work', async () => {
    mocks.token.mockReturnValue('session-A');
    mocks.listStoryWorks.mockResolvedValue({ works: [{ id: 'story with / slash' }] });
    const page = createPage();
    await page.load();
    const tap = {
      currentTarget: { dataset: { id: 'story with / slash' } },
    } as unknown as WechatMiniprogram.TouchEvent;
    page.openWork(tap);
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      url: '/pages/story-work/story-work?id=story%20with%20%2F%20slash',
    });
    mocks.token.mockReturnValue('session-B');
    page.openWork(tap);
    expect(mocks.navigateTo).toHaveBeenCalledOnce();
  });
});
