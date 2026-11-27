import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApiError } from '../../services/commerce';
import {
  createReferralLink,
  createWithdrawal,
  getCommissionAccount,
} from '../../services/commission';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { persistPendingWithdrawal, readPendingWithdrawal } from './withdrawal-retry';
import { canUseCommissionActions, type CommissionAccountStatus } from './commission-state';

const consumerId = '11111111-1111-4111-8111-111111111111';
const storage = new Map<string, unknown>();

vi.mock('../../services/consumer-session', () => ({
  consumerToken: vi.fn(),
  storedConsumerId: vi.fn(),
}));

vi.mock('../../services/commission', () => ({
  createReferralLink: vi.fn(),
  createWithdrawal: vi.fn(),
  getCommissionAccount: vi.fn(),
  listReferralLinks: vi.fn(),
  listWithdrawals: vi.fn(),
}));

type CommissionTestData = {
  loading: boolean;
  accountStatus: CommissionAccountStatus;
  busy: boolean;
  error: string;
  frozenMinor: number;
  availableMinor: number;
  entries: unknown[];
  links: unknown[];
  withdrawals: unknown[];
  amountYuan: string;
  pendingWithdrawal: boolean;
};

type CommissionTestPage = {
  accountUserId: string;
  accountSession: string;
  data: CommissionTestData;
  setData(update: Partial<CommissionTestData>): void;
  createLink(): Promise<void>;
  withdraw(): Promise<void>;
  onHide(): void;
  onUnload(): void;
};

let pageDefinition: CommissionTestPage;

beforeAll(async () => {
  let captured: unknown;
  vi.stubGlobal('Page', (options: unknown) => {
    captured = options;
  });
  await import('./commission');
  if (!captured) throw new Error('Commission Page was not registered');
  pageDefinition = captured as CommissionTestPage;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.mocked(consumerToken).mockReturnValue('session-a');
  vi.mocked(storedConsumerId).mockReturnValue(consumerId);
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
});

function readyPage(): CommissionTestPage {
  const page: CommissionTestPage = {
    ...pageDefinition,
    accountUserId: consumerId,
    accountSession: 'session-a',
    data: { ...pageDefinition.data },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  page.setData({
    loading: false,
    accountStatus: 'ready',
    frozenMinor: 1000,
    availableMinor: 2000,
    amountYuan: '10',
  });
  return page;
}

describe('commission action failures', () => {
  it('rejects a withdrawal after a same-user token rotation without posting', async () => {
    const page = readyPage();
    vi.mocked(consumerToken).mockReturnValue('session-new');
    await page.withdraw();
    expect(createWithdrawal).not.toHaveBeenCalled();
    expect(readPendingWithdrawal(consumerId)).toBeNull();
    expect(page.data.accountStatus).toBe('unauthenticated');
    expect(page.data.availableMinor).toBe(0);
    expect(page.accountSession).toBe('');
  });
  it('does not reload a hidden account when a referral request completes', async () => {
    let resolveLink: () => void = () => {};
    vi.mocked(createReferralLink).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLink = () => resolve({} as never))),
    );
    const page = readyPage();
    const pending = page.createLink();
    page.onHide();
    resolveLink();
    await pending;
    expect(getCommissionAccount).not.toHaveBeenCalled();
    expect(page.data.availableMinor).toBe(0);
    expect(page.data.links).toEqual([]);
    expect(page.data.busy).toBe(false);
  });

  it('retains an ambiguous withdrawal key without showing old error data after hiding', async () => {
    let rejectWithdrawal: () => void = () => {};
    vi.mocked(createWithdrawal).mockImplementationOnce(
      () => new Promise((_, reject) => (rejectWithdrawal = () => reject(new Error('offline')))),
    );
    const page = readyPage();
    const pending = page.withdraw();
    page.onHide();
    rejectWithdrawal();
    await pending;
    expect(readPendingWithdrawal(consumerId)?.amountMinor).toBe(1000);
    expect(page.data.availableMinor).toBe(0);
    expect(page.data.error).toBe('');
    expect(getCommissionAccount).not.toHaveBeenCalled();
  });

  it('confirms the original withdrawal result while hidden without reloading private data', async () => {
    let resolveWithdrawal: () => void = () => {};
    vi.mocked(createWithdrawal).mockImplementationOnce(
      (amountMinor, clientRequestId) =>
        new Promise((resolve) => {
          resolveWithdrawal = () =>
            resolve({
              id: '11111111-1111-4111-8111-111111111111',
              amountMinor,
              clientRequestId,
              status: 'REQUESTED',
              version: 1,
              createdAt: '2026-11-26T00:00:00Z',
              paidAt: null,
            });
        }),
    );
    const page = readyPage();
    const pending = page.withdraw();
    const saved = readPendingWithdrawal(consumerId)!;
    expect(saved.amountMinor).toBe(1000);
    page.onHide();
    resolveWithdrawal();
    await pending;
    expect(readPendingWithdrawal(consumerId)).toBeNull();
    expect(page.data.availableMinor).toBe(0);
    expect(page.data.withdrawals).toEqual([]);
    expect(getCommissionAccount).not.toHaveBeenCalled();
  });

  it('invalidates visible financial data after an account changes during referral creation', async () => {
    let resolveLink: () => void = () => {};
    vi.mocked(createReferralLink).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLink = () => resolve({} as never))),
    );
    const page = readyPage();
    const pending = page.createLink();
    vi.mocked(consumerToken).mockReturnValue('session-b');
    vi.mocked(storedConsumerId).mockReturnValue('22222222-2222-4222-8222-222222222222');
    resolveLink();
    await pending;
    expect(page.data.accountStatus).toBe('unauthenticated');
    expect(page.data.availableMinor).toBe(0);
    expect(page.data.links).toEqual([]);
    expect(getCommissionAccount).not.toHaveBeenCalled();
  });
  it('surfaces failed referral-link creation while preserving the verified account', async () => {
    const page = readyPage();
    vi.mocked(createReferralLink).mockRejectedValueOnce(new CommerceApiError(503));

    await page.createLink();

    expect(page.data.error).toBe('分享链接创建失败。');
    expect(page.data.accountStatus).toBe('ready');
    expect(page.data.availableMinor).toBe(2000);
    expect(page.data.busy).toBe(false);
  });

  it('surfaces a failed withdrawal rather than silently implying success', async () => {
    const page = readyPage();
    vi.mocked(createWithdrawal).mockRejectedValueOnce(new Error('network unavailable'));

    await page.withdraw();

    expect(createWithdrawal).toHaveBeenCalledOnce();
    expect(page.data.error).toContain('提现结果未确认');
    expect(page.data.accountStatus).toBe('ready');
    expect(page.data.amountYuan).toBe('10');
    expect(page.data.pendingWithdrawal).toBe(true);
    expect(readPendingWithdrawal(consumerId)?.amountMinor).toBe(1000);
    expect(page.data.busy).toBe(false);
  });

  it('retries the original withdrawal key after an ambiguous response and clears it only on confirmation', async () => {
    const page = readyPage();
    vi.mocked(createWithdrawal).mockRejectedValueOnce(new Error('network'));
    await page.withdraw();
    const first = vi.mocked(createWithdrawal).mock.calls[0]!;
    expect(first[0]).toBe(1000);
    expect(readPendingWithdrawal(consumerId)?.clientRequestId).toBe(first[1]);

    const freshPage = readyPage();
    vi.mocked(createWithdrawal).mockImplementationOnce((amountMinor, clientRequestId) =>
      Promise.resolve({
        amountMinor,
        clientRequestId,
      } as never),
    );
    const { getCommissionAccount, listReferralLinks, listWithdrawals } =
      await import('../../services/commission');
    vi.mocked(getCommissionAccount).mockResolvedValue({
      frozenMinor: 0,
      availableMinor: 1000,
      entries: [],
    });
    vi.mocked(listReferralLinks).mockResolvedValue({ links: [] });
    vi.mocked(listWithdrawals).mockResolvedValue({ withdrawals: [] });
    await freshPage.withdraw();
    expect(vi.mocked(createWithdrawal).mock.calls[1]).toEqual(first);
    expect(readPendingWithdrawal(consumerId)).toBeNull();
    expect(freshPage.data.pendingWithdrawal).toBe(false);
    expect(freshPage.data.amountYuan).toBe('');
  });

  it('reconciles a lost POST response from authoritative withdrawal records on reload', async () => {
    persistPendingWithdrawal(consumerId, {
      amountMinor: 1000,
      clientRequestId: 'replayed-request-1',
    });
    const { getCommissionAccount, listReferralLinks, listWithdrawals } =
      await import('../../services/commission');
    vi.mocked(getCommissionAccount).mockResolvedValue({
      frozenMinor: 0,
      availableMinor: 0,
      entries: [],
    });
    vi.mocked(listReferralLinks).mockResolvedValue({ links: [] });
    vi.mocked(listWithdrawals).mockResolvedValue({
      withdrawals: [
        {
          id: 'withdrawal-a',
          amountMinor: 1000,
          clientRequestId: 'replayed-request-1',
          status: 'REQUESTED',
        },
      ],
    } as never);
    const page = readyPage();
    await (page as CommissionTestPage & { load: () => Promise<void> }).load();
    expect(readPendingWithdrawal(consumerId)).toBeNull();
    expect(page.data.pendingWithdrawal).toBe(false);
    expect(createWithdrawal).not.toHaveBeenCalled();
  });

  it('blocks different amounts, account switches and missing safe storage before POST', async () => {
    const page = readyPage();
    vi.mocked(createWithdrawal).mockRejectedValueOnce(new Error('timeout'));
    await page.withdraw();
    page.data.amountYuan = '20';
    await page.withdraw();
    expect(createWithdrawal).toHaveBeenCalledTimes(1);
    expect(page.data.error).toContain('原金额');

    vi.mocked(storedConsumerId).mockReturnValue('22222222-2222-4222-8222-222222222222');
    await page.withdraw();
    expect(createWithdrawal).toHaveBeenCalledTimes(1);
    vi.mocked(storedConsumerId).mockReturnValue(consumerId);
    const newPage = readyPage();
    storage.clear();
    vi.stubGlobal('wx', {
      getStorageSync: () => undefined,
      setStorageSync: () => {
        throw new Error('storage unavailable');
      },
    });
    await newPage.withdraw();
    expect(createWithdrawal).toHaveBeenCalledTimes(1);
    expect(newPage.data.error).toContain('无法安全保存');
  });

  it.each(['link', 'withdraw'] as const)(
    'expires the account and blocks further actions after a 401 from %s',
    async (action) => {
      const page = readyPage();
      if (action === 'link') {
        vi.mocked(createReferralLink).mockRejectedValueOnce(new CommerceApiError(401));
        await page.createLink();
      } else {
        vi.mocked(createWithdrawal).mockRejectedValueOnce(new CommerceApiError(401));
        await page.withdraw();
      }

      expect(page.data.accountStatus).toBe('unauthenticated');
      expect(page.data.error).toContain('登录已失效');
      expect(page.data.frozenMinor).toBe(0);
      expect(page.data.availableMinor).toBe(0);
      expect(page.data.links).toEqual([]);
      expect(page.data.withdrawals).toEqual([]);
      expect(canUseCommissionActions(page.data.accountStatus)).toBe(false);
      expect(page.data.busy).toBe(false);

      await page.createLink();
      await page.withdraw();
      expect(createReferralLink).toHaveBeenCalledTimes(action === 'link' ? 1 : 0);
      expect(createWithdrawal).toHaveBeenCalledTimes(action === 'withdraw' ? 1 : 0);
    },
  );
});
