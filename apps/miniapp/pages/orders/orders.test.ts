import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApiError } from '../../services/commerce';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  listOrders: vi.fn(),
  switchTab: vi.fn(),
}));

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
  orders: Array<{ id: string }>;
  loading: boolean;
  error: boolean;
  needsLogin: boolean;
};
type TestPage = {
  readSequence: number;
  data: State;
  setData(changes: Partial<State>): void;
  load(): Promise<void>;
  goToLogin(): void;
};

let definition: Pick<TestPage, 'load' | 'goToLogin'>;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: typeof definition) => {
    definition = page;
  });
  await import('./orders');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('wx', { switchTab: mocks.switchTab });
});

function createPage(): TestPage {
  const page: TestPage = {
    readSequence: 0,
    data: { orders: [], loading: true, error: false, needsLogin: false },
    setData(changes) {
      Object.assign(page.data, changes);
    },
    load() {
      return definition.load.call(page);
    },
    goToLogin() {
      definition.goToLogin.call(page);
    },
  };
  return page;
}

describe('orders: protected list states', () => {
  it('never lets an older order response overwrite a newer refresh', async () => {
    mocks.token.mockReturnValue('account-a');
    const resolve: Array<(value: { orders: Array<{ id: string }> }) => void> = [];
    mocks.listOrders.mockImplementation(() => new Promise((accept) => resolve.push(accept)));
    const page = createPage();
    const older = page.load();
    const newer = page.load();
    resolve[1]!({ orders: [{ id: 'current-order' }] });
    await newer;
    resolve[0]!({ orders: [{ id: 'obsolete-order' }] });
    await older;
    expect(page.data.orders).toEqual([{ id: 'current-order' }]);
    expect(page.data.loading).toBe(false);
  });

  it('does not show orders from a session that logged out during the request', async () => {
    mocks.token.mockReturnValue('account-a');
    let resolve: (value: { orders: Array<{ id: string }> }) => void = () => {};
    mocks.listOrders.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    const page = createPage();
    const pending = page.load();
    mocks.token.mockReturnValue('');
    resolve({ orders: [{ id: 'private-order' }] });
    await pending;
    expect(page.data).toMatchObject({ orders: [], loading: false, needsLogin: true });
  });

  it('fetches the new account when an old account response returns late', async () => {
    mocks.token.mockReturnValue('account-a');
    let resolve: (value: { orders: Array<{ id: string }> }) => void = () => {};
    mocks.listOrders
      .mockImplementationOnce(
        () =>
          new Promise((accept) => {
            resolve = accept;
          }),
      )
      .mockResolvedValueOnce({ orders: [{ id: 'new-account-order' }] });
    const page = createPage();
    const pending = page.load();
    mocks.token.mockReturnValue('account-b');
    resolve({ orders: [{ id: 'old-account-order' }] });
    await pending;
    await vi.waitFor(() => expect(page.data.orders).toEqual([{ id: 'new-account-order' }]));
    expect(mocks.listOrders).toHaveBeenCalledTimes(2);
  });

  it('shows a login action and skips the protected API when signed out', async () => {
    mocks.token.mockReturnValue('');
    const page = createPage();

    await page.load();

    expect(mocks.listOrders).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ loading: false, error: false, needsLogin: true });
    page.goToLogin();
    expect(mocks.switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('loads real order data after an existing session becomes available', async () => {
    mocks.token.mockReturnValue('valid-token');
    const orders = [{ id: 'order-1' }];
    mocks.listOrders.mockResolvedValue({ orders });
    const page = createPage();
    page.data.needsLogin = true;

    await page.load();

    expect(mocks.listOrders).toHaveBeenCalledOnce();
    expect(page.data).toMatchObject({
      orders,
      loading: false,
      error: false,
      needsLogin: false,
    });
  });

  it('treats an expired or revoked session (401) as login required', async () => {
    mocks.token.mockReturnValue('expired-token');
    mocks.listOrders.mockRejectedValue(new CommerceApiError(401));
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({
      orders: [],
      loading: false,
      error: false,
      needsLogin: true,
    });
  });

  it('retains network failures as retryable errors instead of saying login required', async () => {
    mocks.token.mockReturnValue('valid-token');
    mocks.listOrders.mockRejectedValue(new Error('request:fail timeout'));
    const page = createPage();

    await page.load();

    expect(page.data).toMatchObject({ loading: false, error: true, needsLogin: false });
  });
});
