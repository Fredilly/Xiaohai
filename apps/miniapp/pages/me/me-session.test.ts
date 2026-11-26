import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storedConsumerId: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({
  storedConsumerId: mocks.storedConsumerId,
}));

vi.mock('../../services/auth', () => ({
  loginWithWeChat: vi.fn(),
}));

type State = {
  status: string;
  isLoggedIn: boolean;
  consumerUserId: string;
  consumerDisplayId: string;
  avatarUrl: string;
};

type TestPage = {
  data: State;
  setData(changes: Partial<State>): void;
  onShow(): void;
};

let definition: Pick<TestPage, 'onShow'>;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./me');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', {
    getStorageSync: () => '',
  });
});

function createPage(): TestPage {
  const page: TestPage = {
    data: {
      status: '欢迎回来',
      isLoggedIn: true,
      consumerUserId: 'stale-user',
      consumerDisplayId: 'stale-us…',
      avatarUrl: '',
    },
    setData(changes) {
      Object.assign(page.data, changes);
    },
    onShow() {
      definition.onShow.call(page);
    },
  };
  return page;
}

describe('Me page session display consistency', () => {
  it('does not show a stale global user after local session is invalid', () => {
    vi.stubGlobal('getApp', () => ({
      globalData: { consumerUserId: 'stale-user' },
    }));
    mocks.storedConsumerId.mockReturnValue('');
    const page = createPage();

    page.onShow();

    expect(mocks.storedConsumerId).toHaveBeenCalledOnce();
    expect(page.data).toMatchObject({
      status: '登录后查看订单与个人服务',
      isLoggedIn: false,
      consumerUserId: '',
      consumerDisplayId: '',
    });
  });

  it('shows a user only when the stored session is valid', () => {
    mocks.storedConsumerId.mockReturnValue('valid-user-id-abcdef');
    const page = createPage();

    page.onShow();

    expect(page.data).toMatchObject({
      status: '欢迎回来',
      isLoggedIn: true,
      consumerUserId: 'valid-user-id-abcdef',
      consumerDisplayId: 'valid-us…',
    });
  });
});
