import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { listRentals } from '../../services/rental';

vi.mock('../../services/consumer-session', () => ({
  consumerToken: vi.fn(),
  storedConsumerId: vi.fn(),
}));
vi.mock('../../services/rental', () => ({ listRentals: vi.fn() }));

const consumer = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const rental = {
  id: '33333333-3333-4333-8333-333333333333',
  consumerUserId: consumer,
  storeId: '44444444-4444-4444-8444-444444444444',
  storeName: '东门',
  rentalNumber: 'RN-001',
  status: 'RESERVED',
  dueAt: null,
};

type RentalPage = {
  readSequence: number;
  visibleSession: string;
  data: { loading: boolean; needsLogin: boolean; error: string; items: Array<{ id: string }> };
  setData(patch: Record<string, unknown>): void;
  load(): Promise<void>;
  open(event: WechatMiniprogram.TouchEvent): void;
  goToLogin(): void;
};
let definition: RentalPage;
const navigateToMock = vi.fn();
const switchTabMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('Page', (page: RentalPage) => {
    definition = page;
  });
  await import('./rentals');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(consumerToken).mockReturnValue('account-a');
  vi.mocked(storedConsumerId).mockReturnValue(consumer);
  vi.stubGlobal('wx', { navigateTo: navigateToMock, switchTab: switchTabMock });
});

function page(): RentalPage {
  return {
    ...definition,
    readSequence: 0,
    visibleSession: '',
    data: { ...definition.data, items: [] },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

describe('consumer rental list account and stale network scope', () => {
  it('does not fetch protected rental data when signed out', async () => {
    vi.mocked(consumerToken).mockReturnValue('');
    vi.mocked(storedConsumerId).mockReturnValue('');
    const p = page();
    await p.load();
    expect(listRentals).not.toHaveBeenCalled();
    expect(p.data).toMatchObject({ items: [], needsLogin: true, loading: false });
    p.goToLogin();
    expect(switchTabMock).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('renders only own rental records and permits navigation only to listed IDs', async () => {
    vi.mocked(listRentals).mockResolvedValue({ items: [rental] } as never);
    const p = page();
    await p.load();
    expect(p.data.items).toMatchObject([{ id: rental.id }]);
    p.open({ currentTarget: { dataset: { id: rental.id } } } as never);
    p.open({ currentTarget: { dataset: { id: other } } } as never);
    expect(navigateToMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a syntactically valid cross-account response', async () => {
    vi.mocked(listRentals).mockResolvedValue({
      items: [{ ...rental, consumerUserId: other }],
    } as never);
    const p = page();
    await p.load();
    expect(p.data.items).toEqual([]);
    expect(p.data.error).toContain('加载失败');
    expect(p.visibleSession).toBe('');
  });

  it('never backfills the old account after a new account logs in during a request', async () => {
    let resolve: (value: Awaited<ReturnType<typeof listRentals>>) => void = () => {};
    vi.mocked(listRentals)
      .mockImplementationOnce(
        () =>
          new Promise((accept) => {
            resolve = accept;
          }),
      )
      .mockResolvedValueOnce({ items: [] });
    const p = page();
    const pending = p.load();
    vi.mocked(consumerToken).mockReturnValue('account-b');
    vi.mocked(storedConsumerId).mockReturnValue(other);
    resolve({ items: [rental] } as never);
    await pending;
    await vi.waitFor(() => expect(listRentals).toHaveBeenCalledTimes(2));
    expect(p.data.items).toEqual([]);
    expect(p.data.loading).toBe(false);
  });
});
