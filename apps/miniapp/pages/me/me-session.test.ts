import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storedConsumerId: vi.fn(),
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  saveFile: vi.fn(),
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
  chooseAvatar(event: { detail: { avatarUrl: string } }): void;
};

let definition: Pick<TestPage, 'onShow' | 'chooseAvatar'>;

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
    getStorageSync: mocks.getStorageSync,
    setStorageSync: mocks.setStorageSync,
    saveFile: mocks.saveFile,
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
    chooseAvatar(event) {
      definition.chooseAvatar.call(page, event);
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

  it('does not show another account’s saved avatar or a legacy unowned avatar', () => {
    mocks.storedConsumerId.mockReturnValue('account-B');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'account-A' : 'wxfile://avatar-A',
    );
    const page = createPage();
    page.onShow();
    expect(page.data.avatarUrl).toBe('');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'account-B' : 'wxfile://avatar-B',
    );
    page.onShow();
    expect(page.data.avatarUrl).toBe('wxfile://avatar-B');
  });

  it('ignores a late avatar save after an account switch', () => {
    mocks.storedConsumerId.mockReturnValue('account-A');
    const page = createPage();
    page.onShow();
    page.chooseAvatar({ detail: { avatarUrl: 'wxfile://temp-A' } });
    const options: unknown = mocks.saveFile.mock.calls[0]?.[0];
    const callback = (options as { success?: (result: { savedFilePath: string }) => void })
      ?.success;
    expect(callback).toBeTypeOf('function');
    mocks.storedConsumerId.mockReturnValue('account-B');
    callback?.({ savedFilePath: 'wxfile://saved-A' });
    expect(mocks.setStorageSync).not.toHaveBeenCalled();
    expect(page.data.avatarUrl).toBe('');
  });
});
