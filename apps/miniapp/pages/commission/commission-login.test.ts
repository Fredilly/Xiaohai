import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  getCommissionAccount: vi.fn(),
  listReferralLinks: vi.fn(),
  listWithdrawals: vi.fn(),
  createReferralLink: vi.fn(),
  createWithdrawal: vi.fn(),
  switchTab: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/commission', () => ({
  getCommissionAccount: mocks.getCommissionAccount,
  listReferralLinks: mocks.listReferralLinks,
  listWithdrawals: mocks.listWithdrawals,
  createReferralLink: mocks.createReferralLink,
  createWithdrawal: mocks.createWithdrawal,
}));
vi.mock('../../services/commerce', () => ({
  CommerceApiError: class CommerceApiError extends Error {
    constructor(readonly status: number) {
      super(`Commerce API ${status}`);
    }
  },
}));

type State = {
  loading: boolean;
  accountStatus: string;
  error: string;
  busy: boolean;
  frozenMinor: number;
  availableMinor: number;
  amountYuan: string;
  entries: unknown[];
  links: unknown[];
  withdrawals: unknown[];
};
type TestPage = {
  data: State;
  setData(changes: Partial<State>): void;
  load(): Promise<void>;
  goToLogin(): void;
  createLink(): Promise<void>;
  withdraw(): Promise<void>;
};

let definition: TestPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: TestPage) => {
    definition = page;
  });
  await import('./commission');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function page(): TestPage {
  const current: TestPage = {
    ...definition,
    data: {
      ...definition.data,
      entries: [],
      links: [],
      withdrawals: [],
    },
    setData(changes) {
      Object.assign(current.data, changes);
    },
  };
  return current;
}

describe('Commission login-required UI and request guard', () => {
  it('skips all protected GETs when signed out and clears previous account data', async () => {
    mocks.token.mockReturnValue('');
    const current = page();
    Object.assign(current.data, {
      frozenMinor: 1000,
      availableMinor: 200,
      entries: [{ id: 'old' }],
      links: [{ id: 'old' }],
      withdrawals: [{ id: 'old' }],
    });

    await current.load();

    expect(current.data.accountStatus).toBe('unauthenticated');
    expect(current.data.loading).toBe(false);
    expect(current.data.frozenMinor).toBe(0);
    expect(current.data.availableMinor).toBe(0);
    expect(current.data.entries).toEqual([]);
    expect(current.data.links).toEqual([]);
    expect(current.data.withdrawals).toEqual([]);
    expect(mocks.getCommissionAccount).not.toHaveBeenCalled();
    expect(mocks.listReferralLinks).not.toHaveBeenCalled();
    expect(mocks.listWithdrawals).not.toHaveBeenCalled();
  });

  it('sends the login CTA to the existing Me tab, not a login request', () => {
    const current = page();
    current.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('retains the authorized read-only account loading flow', async () => {
    mocks.token.mockReturnValue('test-session');
    mocks.getCommissionAccount.mockResolvedValue({
      frozenMinor: 100,
      availableMinor: 50,
      entries: [],
    });
    mocks.listReferralLinks.mockResolvedValue({ links: [] });
    mocks.listWithdrawals.mockResolvedValue({ withdrawals: [] });

    const current = page();
    await current.load();

    expect(current.data.accountStatus).toBe('ready');
    expect(current.data.availableMinor).toBe(50);
    expect(mocks.getCommissionAccount).toHaveBeenCalledOnce();
    expect(mocks.listReferralLinks).toHaveBeenCalledOnce();
    expect(mocks.listWithdrawals).toHaveBeenCalledOnce();
  });

  it('distinguishes a 401 from network errors', async () => {
    mocks.token.mockReturnValue('expired-session');
    const { CommerceApiError } = await import('../../services/commerce');
    mocks.getCommissionAccount.mockRejectedValueOnce(new CommerceApiError(401));
    mocks.listReferralLinks.mockResolvedValue({ links: [] });
    mocks.listWithdrawals.mockResolvedValue({ withdrawals: [] });

    const current = page();
    await current.load();

    expect(current.data.accountStatus).toBe('unauthenticated');
    expect(current.data.error).toContain('请先登录');
  });

  it('keeps the transient service failure separate and retryable', async () => {
    mocks.token.mockReturnValue('test-session');
    mocks.getCommissionAccount.mockRejectedValueOnce(new Error('timeout'));
    mocks.listReferralLinks.mockResolvedValue({ links: [] });
    mocks.listWithdrawals.mockResolvedValue({ withdrawals: [] });

    const current = page();
    await current.load();

    expect(current.data.accountStatus).toBe('error');
    expect(current.data.error).toContain('重试');
  });

  it('never creates links or withdrawals from a signed-out state', async () => {
    const current = page();
    current.data.accountStatus = 'unauthenticated';
    await current.createLink();
    await current.withdraw();

    expect(mocks.createReferralLink).not.toHaveBeenCalled();
    expect(mocks.createWithdrawal).not.toHaveBeenCalled();
  });
});
