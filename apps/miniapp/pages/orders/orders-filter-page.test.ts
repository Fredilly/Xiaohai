import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: vi.fn(), listOrders: vi.fn() }));
vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/commerce', () => ({
  CommerceApiError: class CommerceApiError extends Error {
    constructor(readonly status: number) {
      super(`Commerce API ${status}`);
    }
  },
  listOrders: mocks.listOrders,
}));

type State = {
  view: string;
  viewTitle: string;
  viewNote: string;
  unsupported: boolean;
  orders: Array<{ id: string; status: string }>;
  loading: boolean;
  error: boolean;
  needsLogin: boolean;
};
type TestPage = {
  data: State;
  setData(changes: Partial<State>): void;
  onLoad(query: Record<string, string | undefined>): void;
  load(): Promise<void>;
};

let definition: TestPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: TestPage) => {
    definition = page;
  });
  await import('./orders');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => vi.clearAllMocks());

function makePage(): TestPage {
  const page: TestPage = {
    ...definition,
    data: { ...definition.data, orders: [] },
    setData(changes) {
      Object.assign(page.data, changes);
    },
  };
  return page;
}

const orders = [
  { id: 'a', status: 'UNPAID' },
  { id: 'b', status: 'PAID' },
  { id: 'c', status: 'DELIVERING' },
  { id: 'd', status: 'REFUNDING' },
];

describe('Orders page view handling', () => {
  it('filters an authenticated list locally without modifying the server request', async () => {
    mocks.token.mockReturnValue('test-token');
    mocks.listOrders.mockResolvedValue({ orders });
    const page = makePage();

    page.onLoad({ view: 'unpaid' });
    await page.load();

    expect(mocks.listOrders).toHaveBeenCalledOnce();
    expect(page.data.viewTitle).toBe('待付款');
    expect(page.data.orders).toEqual([{ id: 'a', status: 'UNPAID' }]);
  });

  it('keeps View All unchanged', async () => {
    mocks.token.mockReturnValue('test-token');
    mocks.listOrders.mockResolvedValue({ orders });
    const page = makePage();

    page.onLoad({});
    await page.load();

    expect(page.data.viewTitle).toBe('我的订单');
    expect(page.data.orders).toEqual(orders);
  });

  it('never mislabels unreviewed or pending shipment records without supported data', async () => {
    mocks.token.mockReturnValue('test-token');
    const page = makePage();

    page.onLoad({ view: 'review' });
    await page.load();

    expect(page.data.unsupported).toBe(true);
    expect(page.data.orders).toEqual([]);
    expect(page.data.loading).toBe(false);
    expect(mocks.listOrders).not.toHaveBeenCalled();
  });

  it('preserves the login-required state from PR #136 when signed out', async () => {
    mocks.token.mockReturnValue('');
    const page = makePage();

    page.onLoad({ view: 'receiving' });
    await page.load();

    expect(page.data.needsLogin).toBe(true);
    expect(mocks.listOrders).not.toHaveBeenCalled();
  });

  it('filters refund statuses without inventing a review/after-sale record', async () => {
    mocks.token.mockReturnValue('test-token');
    mocks.listOrders.mockResolvedValue({ orders });
    const page = makePage();

    page.onLoad({ view: 'after-sales' });
    await page.load();

    expect(page.data.orders).toEqual([{ id: 'd', status: 'REFUNDING' }]);
    expect(page.data.viewNote).toContain('其他售后');
  });
});
