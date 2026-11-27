import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storedConsumerId: vi.fn(),
  consumerToken: vi.fn(),
  clearConsumerSession: vi.fn(),
  getStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  removeSavedFile: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({
  storedConsumerId: mocks.storedConsumerId,
  consumerToken: mocks.consumerToken,
  clearConsumerSession: mocks.clearConsumerSession,
}));

type State = {
  isLoggedIn: boolean;
  consumerDisplayId: string;
  avatarSaved: boolean;
  notice: string;
};
type SettingsPage = {
  data: State;
  setData(changes: Partial<State>): void;
  onShow(): void;
  logout(): void;
  clearAvatar(): void;
};

let definition: SettingsPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: SettingsPage) => {
    definition = page;
  });
  await import('./settings');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storedConsumerId.mockReturnValue('consumer-123456789');
  mocks.consumerToken.mockReturnValue('session-A');
  mocks.getStorageSync.mockImplementation((key: string) =>
    key === 'xiaohai.consumer.avatar.owner' ? 'consumer-123456789' : 'wxfile://user/avatar.png',
  );
  vi.stubGlobal('wx', {
    getStorageSync: mocks.getStorageSync,
    removeStorageSync: mocks.removeStorageSync,
    removeSavedFile: mocks.removeSavedFile,
    showModal: mocks.showModal,
  });
});

function createPage(): SettingsPage {
  const page: SettingsPage = {
    data: { isLoggedIn: false, consumerDisplayId: '', avatarSaved: false, notice: '' },
    setData(changes) {
      Object.assign(page.data, changes);
    },
    onShow() {
      definition.onShow.call(page);
    },
    logout() {
      definition.logout.call(page);
    },
    clearAvatar() {
      definition.clearAvatar.call(page);
    },
  };
  return page;
}

function respondToConfirmation(confirm: boolean) {
  expect(mocks.showModal).toHaveBeenCalledOnce();
  const options: unknown = mocks.showModal.mock.lastCall?.[0];
  if (!options || typeof options !== 'object' || !('success' in options)) {
    throw new Error('Expected a confirmation callback');
  }
  const callback = options.success;
  if (typeof callback !== 'function') throw new Error('Invalid confirmation callback');
  (callback as (result: { confirm: boolean }) => void)({ confirm });
}

describe('Device-local consumer settings', () => {
  it('shows the active local account and saved avatar', () => {
    const page = createPage();
    page.onShow();
    expect(page.data).toMatchObject({
      isLoggedIn: true,
      consumerDisplayId: 'consumer…',
      avatarSaved: true,
    });
  });

  it('does not offer logout for an unsigned-in account', () => {
    mocks.storedConsumerId.mockReturnValue('');
    mocks.getStorageSync.mockReturnValue('');
    const page = createPage();
    page.onShow();
    page.logout();
    expect(page.data.isLoggedIn).toBe(false);
    expect(mocks.showModal).not.toHaveBeenCalled();
    expect(mocks.clearConsumerSession).not.toHaveBeenCalled();
  });

  it('keeps the session and avatar when logout is cancelled', () => {
    const page = createPage();
    page.onShow();
    page.logout();
    respondToConfirmation(false);
    expect(mocks.clearConsumerSession).not.toHaveBeenCalled();
    expect(mocks.removeStorageSync).not.toHaveBeenCalled();
    expect(mocks.removeSavedFile).not.toHaveBeenCalled();
    expect(page.data.isLoggedIn).toBe(true);
  });

  it('logs out only the current device after explicit confirmation', () => {
    const page = createPage();
    page.onShow();
    page.logout();
    respondToConfirmation(true);
    expect(mocks.clearConsumerSession).toHaveBeenCalledOnce();
    expect(mocks.removeStorageSync).toHaveBeenCalledWith('xiaohai.consumer.avatar');
    expect(mocks.removeStorageSync).toHaveBeenCalledWith('xiaohai.consumer.avatar.owner');
    expect(mocks.removeSavedFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'wxfile://user/avatar.png' }),
    );
    expect(page.data).toMatchObject({
      isLoggedIn: false,
      consumerDisplayId: '',
      avatarSaved: false,
      notice: '已退出当前设备登录',
    });
  });

  it('only clears the avatar when its confirmation is accepted', () => {
    const page = createPage();
    page.onShow();
    page.clearAvatar();
    respondToConfirmation(true);
    expect(mocks.clearConsumerSession).not.toHaveBeenCalled();
    expect(mocks.removeStorageSync).toHaveBeenCalledWith('xiaohai.consumer.avatar');
    expect(mocks.removeStorageSync).toHaveBeenCalledWith('xiaohai.consumer.avatar.owner');
    expect(mocks.removeSavedFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'wxfile://user/avatar.png' }),
    );
    expect(page.data).toMatchObject({ isLoggedIn: true, avatarSaved: false });
  });

  it('keeps the avatar when clearing is cancelled', () => {
    const page = createPage();
    page.onShow();
    page.clearAvatar();
    respondToConfirmation(false);
    expect(mocks.removeStorageSync).not.toHaveBeenCalled();
    expect(mocks.removeSavedFile).not.toHaveBeenCalled();
    expect(page.data.avatarSaved).toBe(true);
  });

  it('cannot log out account B from an account A confirmation dialog', () => {
    const page = createPage();
    page.onShow();
    page.logout();
    mocks.storedConsumerId.mockReturnValue('consumer-B');
    mocks.consumerToken.mockReturnValue('session-B');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'consumer-B' : 'wxfile://B/avatar.png',
    );

    respondToConfirmation(true);

    expect(mocks.clearConsumerSession).not.toHaveBeenCalled();
    expect(mocks.removeStorageSync).not.toHaveBeenCalled();
    expect(mocks.removeSavedFile).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ isLoggedIn: true, consumerDisplayId: 'consumer…', avatarSaved: true });
  });

  it('cannot delete account B avatar from an account A confirmation dialog', () => {
    const page = createPage();
    page.onShow();
    page.clearAvatar();
    mocks.storedConsumerId.mockReturnValue('consumer-B');
    mocks.consumerToken.mockReturnValue('session-B');
    mocks.getStorageSync.mockImplementation((key: string) =>
      key === 'xiaohai.consumer.avatar.owner' ? 'consumer-B' : 'wxfile://B/avatar.png',
    );

    respondToConfirmation(true);

    expect(mocks.removeStorageSync).not.toHaveBeenCalled();
    expect(mocks.removeSavedFile).not.toHaveBeenCalled();
    expect(page.data.avatarSaved).toBe(true);
  });

  it('does not let an old logout confirmation invalidate a refreshed session for the same account', () => {
    const page = createPage();
    page.onShow();
    page.logout();
    mocks.consumerToken.mockReturnValue('fresh-session-A');

    respondToConfirmation(true);

    expect(mocks.clearConsumerSession).not.toHaveBeenCalled();
    expect(mocks.removeStorageSync).not.toHaveBeenCalled();
    expect(page.data.isLoggedIn).toBe(true);
  });
});
