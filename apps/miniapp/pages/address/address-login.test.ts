import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  switchTab: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/commerce', () => ({
  CommerceApiError: class CommerceApiError extends Error {
    constructor(readonly status: number) {
      super(`Commerce API ${status}`);
    }
  },
  listAddresses: mocks.listAddresses,
  createAddress: mocks.createAddress,
  updateAddress: mocks.updateAddress,
  deleteAddress: mocks.deleteAddress,
}));

type State = {
  addresses: Array<{ id: string }>;
  loading: boolean;
  error: boolean;
  needsLogin: boolean;
  mutating: boolean;
};
type PageDef = {
  readSequence: number;
  visibleSession: string;
  mutationInFlight: boolean;
  data: State;
  setData(changes: Partial<State>): void;
  load(): Promise<void>;
  goToLogin(): void;
  add(): Promise<void>;
  remove(event: WechatMiniprogram.TouchEvent): Promise<void>;
};

let definition: PageDef;
beforeAll(async () => {
  vi.stubGlobal('Page', (page: PageDef) => {
    definition = page;
  });
  await import('./address');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function page(): PageDef {
  const p: PageDef = {
    ...definition,
    data: { addresses: [], loading: true, error: false, needsLogin: false, mutating: false },
    setData(changes) {
      Object.assign(p.data, changes);
    },
  };
  return p;
}

describe('address protected UI', () => {
  it('drops an old address response when the account changes before it returns', async () => {
    mocks.token.mockReturnValue('account-a');
    let resolve: (value: { addresses: Array<{ id: string }> }) => void = () => {};
    mocks.listAddresses.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    const p = page();
    const pending = p.load();
    mocks.token.mockReturnValue('');
    resolve({ addresses: [{ id: 'private-address' }] });
    await pending;
    expect(p.data).toMatchObject({ addresses: [], loading: false, needsLogin: true });
  });

  it('ignores a stale refresh when a newer address request has completed', async () => {
    mocks.token.mockReturnValue('account-a');
    const resolve: Array<(value: { addresses: Array<{ id: string }> }) => void> = [];
    mocks.listAddresses.mockImplementation(() => new Promise((accept) => resolve.push(accept)));
    const p = page();
    const earlier = p.load();
    const newer = p.load();
    resolve[1]!({ addresses: [{ id: 'current' }] });
    await newer;
    resolve[0]!({ addresses: [{ id: 'stale' }] });
    await earlier;
    expect(p.data.addresses).toEqual([{ id: 'current' }]);
  });

  it('serializes delete taps and refreshes only the confirmed account address list', async () => {
    mocks.token.mockReturnValue('account-a');
    let release: () => void = () => {};
    mocks.deleteAddress.mockImplementationOnce(
      () =>
        new Promise<void>((accept) => {
          release = accept;
        }),
    );
    mocks.listAddresses.mockResolvedValue({ addresses: [] });
    const p = page();
    p.visibleSession = 'account-a';
    p.data.addresses = [{ id: 'address-1' }];
    const event = { currentTarget: { dataset: { id: 'address-1' } } } as never;
    const first = p.remove(event);
    await p.remove(event);
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(p.data).toMatchObject({ addresses: [], mutating: false, error: false });
  });

  it('stops address collection immediately if the consumer logs out mid-form', async () => {
    mocks.token.mockReturnValue('account-a');
    let answer: (value: { confirm: boolean; content: string }) => void = () => {};
    const showModal = vi.fn((options: { success: typeof answer }) => {
      answer = options.success;
    });
    vi.stubGlobal('wx', { switchTab: mocks.switchTab, showModal });
    const p = page();
    p.visibleSession = 'account-a';
    const pending = p.add();
    mocks.token.mockReturnValue('');
    answer({ confirm: true, content: 'private recipient' });
    await pending;
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(mocks.createAddress).not.toHaveBeenCalled();
    expect(p.data.addresses).toEqual([]);
    expect(p.data.mutating).toBe(false);
  });

  it('does not fetch personal address data when signed out; offers login', async () => {
    mocks.token.mockReturnValue('');
    const p = page();
    await p.load();
    expect(p.data).toMatchObject({ loading: false, error: false, needsLogin: true });
    expect(mocks.listAddresses).not.toHaveBeenCalled();
    p.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('renders an authorized list normally', async () => {
    mocks.token.mockReturnValue('test-session');
    const addresses = [{ id: 'address-1' }];
    mocks.listAddresses.mockResolvedValue({ addresses });
    const p = page();
    await p.load();
    expect(p.data).toMatchObject({ addresses, loading: false, needsLogin: false });
  });

  it('distinguishes 401 from transient network errors', async () => {
    mocks.token.mockReturnValue('expired');
    const p = page();
    mocks.listAddresses.mockRejectedValueOnce(new Error('Commerce API 401'));
    await p.load();
    expect(p.data.error).toBe(true);
    const { CommerceApiError } = await import('../../services/commerce');
    mocks.listAddresses.mockRejectedValueOnce(new CommerceApiError(401));
    await p.load();
    expect(p.data).toMatchObject({ needsLogin: true, error: false, addresses: [] });
  });

  it('keeps network failures retryable', async () => {
    mocks.token.mockReturnValue('test-session');
    mocks.listAddresses.mockRejectedValue(new Error('timeout'));
    const p = page();
    await p.load();
    expect(p.data).toMatchObject({ error: true, needsLogin: false });
  });

  it('blocks create/delete operations when no session is available', async () => {
    mocks.token.mockReturnValue('');
    const p = page();
    await p.add();
    await p.remove({ currentTarget: { dataset: { id: 'fake' } } } as never);
    expect(mocks.createAddress).not.toHaveBeenCalled();
    expect(mocks.deleteAddress).not.toHaveBeenCalled();
  });
});
