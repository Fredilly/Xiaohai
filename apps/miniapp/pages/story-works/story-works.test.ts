import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryApiError } from '../../services/story';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listStoryWorks: vi.fn(),
  switchTab: vi.fn(),
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
  data: State;
  setData(changes: Partial<State>): void;
  load(): Promise<void>;
  goToLogin(): void;
};

let definition: Pick<TestPage, 'load' | 'goToLogin'>;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./story-works');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function createPage(): TestPage {
  const page: TestPage = {
    data: { works: [], loading: true, error: false, needsLogin: false },
    setData(changes) {
      Object.assign(page.data, changes);
    },
    load() {
      return definition.load.call(page);
    },
    goToLogin() {
      definition.goToLogin.call(page);
    },
  };
  return page;
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
});
