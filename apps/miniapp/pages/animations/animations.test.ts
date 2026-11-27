import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationApiError } from '../../services/animation';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listAnimations: vi.fn(),
  switchTab: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/animation', () => ({
  AnimationApiError: class AnimationApiError extends Error {
    constructor(readonly status: number) {
      super(`Animation API ${status}`);
    }
  },
  listAnimations: mocks.listAnimations,
}));

type State = {
  animations: Array<{ id: string }>;
  loading: boolean;
  needsLogin: boolean;
  error: string;
};
type TestPage = {
  data: State;
  readSequence: number;
  wasHidden: boolean;
  pageClosed: boolean;
  loadedSession: string;
  setData(changes: Partial<State>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  goToLogin(): void;
  open(event: WechatMiniprogram.TouchEvent): void;
};

let definition: TestPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: TestPage) => {
    definition = page;
  });
  await import('./animations');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab, navigateTo: mocks.navigateTo });
});

function page(): TestPage {
  const instance: TestPage = {
    ...definition,
    readSequence: 0,
    wasHidden: false,
    pageClosed: false,
    loadedSession: '',
    data: { animations: [], loading: true, needsLogin: false, error: '' },
    setData(changes) {
      Object.assign(instance.data, changes);
    },
  };
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('AI animation list: private work isolation', () => {
  it('avoids unauthenticated API calls and gives an actual login path', async () => {
    mocks.token.mockReturnValue('');
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({ animations: [], needsLogin: true, loading: false });
    expect(mocks.listAnimations).not.toHaveBeenCalled();
    instance.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('renders current works and navigates only while the same session is active', async () => {
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations.mockResolvedValue({ animations: [{ id: 'animation/id' }] });
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({ animations: [{ id: 'animation/id' }], loading: false });
    const tap = {
      currentTarget: { dataset: { id: 'animation/id' } },
    } as unknown as WechatMiniprogram.TouchEvent;
    instance.open(tap);
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      url: '/pages/animation-detail/animation-detail?id=animation%2Fid',
    });
    instance.open({ currentTarget: { dataset: { id: 'invented-id' } } } as never);
    expect(mocks.navigateTo).toHaveBeenCalledOnce();
    mocks.token.mockReturnValue('account-B');
    instance.open(tap);
    expect(mocks.navigateTo).toHaveBeenCalledOnce();
  });

  it('shows login-required for expired sessions and retryable errors for network failures', async () => {
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations
      .mockRejectedValueOnce(new AnimationApiError(401))
      .mockRejectedValueOnce(new Error('timeout'));
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({ needsLogin: true, error: '', loading: false });
    await instance.load();
    expect(instance.data).toMatchObject({
      needsLogin: false,
      error: '动画作品加载失败，请检查网络后重试。',
    });
  });

  it('rejects a late earlier account response when the latest account has loaded', async () => {
    const old = deferred<{ animations: State['animations'] }>();
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ animations: [{ id: 'new' }] });
    const instance = page();
    const pending = instance.load();
    mocks.token.mockReturnValue('account-B');
    await instance.load();
    old.resolve({ animations: [{ id: 'private-old' }] });
    await pending;
    expect(instance.data.animations).toEqual([{ id: 'new' }]);
    expect(instance.loadedSession).toBe('account-B');
  });

  it('automatically switches to the newer account if the old request was the only one', async () => {
    const old = deferred<{ animations: State['animations'] }>();
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ animations: [{ id: 'account-B-work' }] });
    const instance = page();
    const pending = instance.load();
    mocks.token.mockReturnValue('account-B');
    old.resolve({ animations: [{ id: 'account-A-work' }] });
    await pending;
    await vi.waitFor(() => expect(instance.data.animations).toEqual([{ id: 'account-B-work' }]));
  });

  it('clears old results on hide and ignores in-flight replies until shown again', async () => {
    const old = deferred<{ animations: State['animations'] }>();
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ animations: [{ id: 'current' }] });
    const instance = page();
    const pending = instance.load();
    instance.onHide();
    old.resolve({ animations: [{ id: 'old' }] });
    await pending;
    expect(instance.data.animations).toEqual([]);
    instance.onShow();
    await vi.waitFor(() => expect(instance.data.animations).toEqual([{ id: 'current' }]));
    instance.onUnload();
    expect(instance.loadedSession).toBe('');
  });

  it('never reloads or opens a disposed animation list after a late response', async () => {
    const old = deferred<{ animations: State['animations'] }>();
    mocks.token.mockReturnValue('account-A');
    mocks.listAnimations.mockReturnValueOnce(old.promise);
    const instance = page();
    const pending = instance.load();
    instance.onUnload();
    old.resolve({ animations: [{ id: 'old-private' }] });
    await pending;
    instance.onShow();
    await instance.load();
    instance.open({ currentTarget: { dataset: { id: 'old-private' } } } as never);
    instance.goToLogin();
    expect(instance.data.animations).toEqual([]);
    expect(instance.data.loading).toBe(false);
    expect(mocks.listAnimations).toHaveBeenCalledOnce();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    expect(mocks.switchTab).not.toHaveBeenCalled();
  });
});
