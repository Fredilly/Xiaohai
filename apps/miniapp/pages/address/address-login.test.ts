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
};
type PageDef = {
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
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function page(): PageDef {
  const p: PageDef = {
    ...definition,
    data: { addresses: [], loading: true, error: false, needsLogin: false },
    setData(changes) {
      Object.assign(p.data, changes);
    },
  };
  return p;
}

describe('address protected UI', () => {
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
    await p.remove({ currentTarget: { dataset: { id: 'fake' } } } as unknown as WechatMiniprogram.TouchEvent);
    expect(mocks.createAddress).not.toHaveBeenCalled();
    expect(mocks.deleteAddress).not.toHaveBeenCalled();
  });
});
