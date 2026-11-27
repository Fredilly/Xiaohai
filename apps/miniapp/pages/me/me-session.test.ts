import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginWithWeChat } from '../../services/auth';

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
  isLoading: boolean;
  isLoggedIn: boolean;
  consumerUserId: string;
  consumerDisplayId: string;
  avatarUrl: string;
};

type TestPage = {
  data: State;
  setData(changes: Partial<State>): void;
  onShow(): void;
  login(): Promise<void>;
  chooseAvatar(event: { detail: { avatarUrl: string } }): void;
};

let definition: Pick<TestPage, 'onShow' | 'login' | 'chooseAvatar'>;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./me');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loginWithWeChat).mockReset();
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
      isLoading: false,
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
    login() {
      return definition.login.call(page);
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

  it('shows the active account avatar after a successful login', async () => {
    mocks.storedConsumerId.mockReturnValue('account-B');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'account-B' : 'wxfile://avatar-B',
    );
    vi.mocked(loginWithWeChat).mockResolvedValue({
      consumer: { id: 'account-B' },
      session: { token: 'session-B', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const page = createPage();

    await page.login();

    expect(page.data).toMatchObject({
      isLoggedIn: true,
      isLoading: false,
      consumerUserId: 'account-B',
      avatarUrl: 'wxfile://avatar-B',
      status: '欢迎回来',
    });
  });

  it('does not blank the new account when an older login attempt fails', async () => {
    mocks.storedConsumerId.mockReturnValue('');
    let rejectOld: (error: Error) => void = () => {};
    vi.mocked(loginWithWeChat).mockImplementation(
      () => new Promise((_, reject) => (rejectOld = reject)),
    );
    const page = createPage();
    const pending = page.login();

    mocks.storedConsumerId.mockReturnValue('account-B');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'account-B' : 'wxfile://avatar-B',
    );
    rejectOld(new Error('CONSUMER_SESSION_CHANGED'));
    await pending;

    expect(page.data).toMatchObject({
      isLoggedIn: true,
      isLoading: false,
      consumerUserId: 'account-B',
      avatarUrl: 'wxfile://avatar-B',
      status: '欢迎回来',
    });
  });
});
