import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { cancelRental, getRental, randomId } from '../../services/rental';
import { pendingCancellationKey } from '../../services/rental-retry';

vi.mock('../../services/consumer-session', () => ({
  consumerToken: vi.fn(),
  storedConsumerId: vi.fn(),
}));
vi.mock('../../services/rental', () => ({
  cancelRental: vi.fn(),
  getRental: vi.fn(),
  randomId: vi.fn(),
}));

const consumer = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const rentalId = '33333333-3333-4333-8333-333333333333';
const requestKey = '55555555-5555-4555-8555-555555555555';
const rental = {
  id: rentalId,
  consumerUserId: consumer,
  storeId: '44444444-4444-4444-8444-444444444444',
  storeName: '东门',
  rentalNumber: 'RN-001',
  status: 'RESERVED',
  dueAt: null,
};

type RentalDetailPage = {
  readSequence: number;
  visibleSession: string;
  visibleUserId: string;
  data: {
    id: string;
    loading: boolean;
    busy: boolean;
    needsLogin: boolean;
    error: string;
    rental: (typeof rental & { statusText: string; dueText: string }) | null;
  };
  setData(patch: Record<string, unknown>): void;
  onLoad(query: Record<string, string | undefined>): void;
  onHide(): void;
  load(): Promise<void>;
  cancel(): Promise<void>;
  goToLogin(): void;
};
let definition: RentalDetailPage;
let storage: Map<string, unknown>;
const switchTabMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('Page', (page: RentalDetailPage) => {
    definition = page;
  });
  await import('./rental-detail');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  storage = new Map();
  vi.mocked(consumerToken).mockReturnValue('account-a');
  vi.mocked(storedConsumerId).mockReturnValue(consumer);
  vi.mocked(randomId).mockReturnValue(requestKey);
  vi.mocked(getRental).mockResolvedValue(rental as never);
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    switchTab: switchTabMock,
  });
});

function page(): RentalDetailPage {
  const p = {
    ...definition,
    readSequence: 0,
    visibleSession: '',
    visibleUserId: '',
    data: { ...definition.data, rental: null },
    setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  };
  p.onLoad({ id: rentalId });
  return p;
}

describe('rental detail identity and cancellation retry', () => {
  it('does not fetch rental details without a consumer session', async () => {
    vi.mocked(consumerToken).mockReturnValue('');
    vi.mocked(storedConsumerId).mockReturnValue('');
    const p = page();
    await p.load();
    expect(getRental).not.toHaveBeenCalled();
    expect(p.data).toMatchObject({ needsLogin: true, loading: false, rental: null });
    p.goToLogin();
    expect(switchTabMock).toHaveBeenCalledWith({ url: '/pages/me/me' });
  });

  it('does not render another consumer or rental ID, or allow cancellation', async () => {
    vi.mocked(getRental).mockResolvedValue({ ...rental, consumerUserId: other } as never);
    const p = page();
    await p.load();
    expect(p.data.rental).toBeNull();
    expect(p.visibleSession).toBe('');
    await p.cancel();
    expect(cancelRental).not.toHaveBeenCalled();
    vi.mocked(getRental).mockResolvedValue({ ...rental, id: other } as never);
    await p.load();
    expect(p.data.rental).toBeNull();
  });

  it('replays the same stored key after a lost cancellation response', async () => {
    const p = page();
    await p.load();
    vi.mocked(cancelRental)
      .mockRejectedValueOnce(new Error('request:fail timeout'))
      .mockResolvedValueOnce({ ...rental, status: 'CANCELLED' } as never);
    await p.cancel();
    expect(pendingCancellationKey(consumer, rentalId)).toBe(requestKey);
    expect(p.data.error).toContain('未确认');
    await p.load();
    vi.mocked(getRental).mockResolvedValueOnce({ ...rental, status: 'CANCELLED' } as never);
    await p.cancel();
    expect(cancelRental).toHaveBeenNthCalledWith(1, rentalId, requestKey);
    expect(cancelRental).toHaveBeenNthCalledWith(2, rentalId, requestKey);
    expect(pendingCancellationKey(consumer, rentalId)).toBeNull();
    expect(p.data.rental?.status).toBe('CANCELLED');
  });

  it('clears an uncertain cancellation key only after GET confirms cancelled', async () => {
    const p = page();
    await p.load();
    vi.mocked(cancelRental).mockRejectedValueOnce(new Error('network'));
    await p.cancel();
    expect(pendingCancellationKey(consumer, rentalId)).toBe(requestKey);
    vi.mocked(getRental).mockResolvedValueOnce({ ...rental, status: 'CANCELLED' } as never);
    await p.load();
    expect(pendingCancellationKey(consumer, rentalId)).toBeNull();
    await p.cancel();
    expect(cancelRental).toHaveBeenCalledTimes(1);
  });

  it('serializes cancellation taps and discards a hidden page response', async () => {
    const p = page();
    await p.load();
    let resolveCancel: (value: Awaited<ReturnType<typeof cancelRental>>) => void = () => {};
    vi.mocked(cancelRental).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const first = p.cancel();
    const second = p.cancel();
    expect(cancelRental).toHaveBeenCalledTimes(1);
    p.onHide();
    resolveCancel({ ...rental, status: 'CANCELLED' } as never);
    await Promise.all([first, second]);
    expect(p.data.rental).toBeNull();
    expect(p.visibleSession).toBe('');
  });

  it('never backfills an old account after a session switch', async () => {
    let resolve: (value: Awaited<ReturnType<typeof getRental>>) => void = () => {};
    vi.mocked(getRental)
      .mockImplementationOnce(
        () =>
          new Promise((accept) => {
            resolve = accept;
          }),
      )
      .mockResolvedValueOnce({ ...rental, consumerUserId: other } as never);
    const p = page();
    const request = p.load();
    vi.mocked(consumerToken).mockReturnValue('account-b');
    vi.mocked(storedConsumerId).mockReturnValue(other);
    resolve(rental as never);
    await request;
    await vi.waitFor(() => expect(getRental).toHaveBeenCalledTimes(2));
    expect(p.data.rental?.consumerUserId).toBe(other);
    expect(p.visibleUserId).toBe(other);
  });
});
