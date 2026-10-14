import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApiError } from '../../services/commerce';
import { createReferralLink, createWithdrawal } from '../../services/commission';
import { canUseCommissionActions, type CommissionAccountStatus } from './commission-state';

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
};

type CommissionTestPage = {
  data: CommissionTestData;
  setData(update: Partial<CommissionTestData>): void;
  createLink(): Promise<void>;
  withdraw(): Promise<void>;
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
});

function readyPage(): CommissionTestPage {
  const page: CommissionTestPage = {
    ...pageDefinition,
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
    expect(page.data.error).toBe('提现申请失败，请检查可用余额或稍后重试。');
    expect(page.data.accountStatus).toBe('ready');
    expect(page.data.amountYuan).toBe('10');
    expect(page.data.busy).toBe(false);
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
