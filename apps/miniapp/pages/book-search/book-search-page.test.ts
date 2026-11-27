import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { searchInventory } from '../../services/inventory';
import { consumerToken, storedConsumerId } from '../../services/consumer-session';
import { createRental, randomId } from '../../services/rental';

vi.mock('../../services/inventory', () => ({ searchInventory: vi.fn() }));
vi.mock('../../services/rental', () => ({ createRental: vi.fn(), randomId: vi.fn() }));
vi.mock('../../services/consumer-session', () => ({
  consumerToken: vi.fn(),
  storedConsumerId: vi.fn(),
}));

const rentalConsumer = '11111111-1111-4111-8111-111111111111';
const rentalStore = '22222222-2222-4222-8222-222222222222';
const rentalSku = '33333333-3333-4333-8333-333333333333';
const rentalKey = '44444444-4444-4444-8444-444444444444';

type SearchPage = {
  data: {
    query: string;
    loading: boolean;
    searched: boolean;
    errorMessage: string;
    selectedAvailabilityIndex: number;
    nearbyMode: boolean;
    latitude: number | null;
    longitude: number | null;
    items: Array<{
      key: string;
      displayCoverUrl: string;
      sku: { id: string };
      store: { id: string };
      product: { id: string };
      sellAvailable: boolean;
      rentAvailable: boolean;
    }>;
    reserving: boolean;
  };
  searchRequestVersion: number;
  locationRequestVersion: number;
  pageClosed: boolean;
  wasHidden: boolean;
  rentalReservationInFlight: boolean;
  rentalWritePending: boolean;
  reservationViewVersion: number;
  reservationNeedsReview: boolean;
  setData(changes: Record<string, unknown>): void;
  onShow(): void;
  onHide(): void;
  submitSearch(): Promise<void>;
  useNearby(): Promise<void>;
  disableNearby(): Promise<void>;
  onUnload(): void;
  openStore(event: WechatMiniprogram.TouchEvent): void;
  openProduct(event: WechatMiniprogram.TouchEvent): void;
  coverError(event: WechatMiniprogram.TouchEvent): void;
  reserveRental(event: WechatMiniprogram.TouchEvent): Promise<void>;
};

const read = vi.mocked(searchInventory);
let definition: SearchPage;

function inventoryItem(id: string, cover: string) {
  return {
    sku: { id: `sku-${id}`, priceMinor: 1200 },
    book: { title: id },
    product: { id: `product-${id}`, coverUrl: cover },
    store: { id: `store-${id}`, distanceKm: null },
    sellAvailable: true,
    rentAvailable: true,
  };
}

function reservationItem() {
  return {
    ...inventoryItem('reservation', 'https://bos.invalid/rental.jpg'),
    key: `${rentalSku}:${rentalStore}`,
    displayCoverUrl: 'https://bos.invalid/rental.jpg',
    sku: { id: rentalSku, priceMinor: 1200 },
    store: { id: rentalStore, distanceKm: null },
  };
}

function page(): SearchPage {
  return {
    ...definition,
    data: {
      query: '',
      loading: false,
      searched: false,
      errorMessage: '',
      selectedAvailabilityIndex: 0,
      nearbyMode: false,
      latitude: null,
      longitude: null,
      items: [],
      reserving: false,
    },
    searchRequestVersion: 0,
    locationRequestVersion: 0,
    pageClosed: false,
    wasHidden: false,
    rentalReservationInFlight: false,
    rentalWritePending: false,
    reservationViewVersion: 0,
    reservationNeedsReview: false,
    setData(changes: Record<string, unknown>) {
      Object.assign(this.data, changes);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: SearchPage) => {
    definition = options;
  });
  await import('./book-search');
});
afterEach(() => vi.resetAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe('inventory book-search weak-network and permission recovery (#32/#70)', () => {
  it('serializes reservation taps before the confirmation modal can complete', async () => {
    const storage = new Map<string, unknown>();
    let confirm: (result: { confirm: boolean }) => void = () => {};
    const showModal = vi.fn((options: { success: typeof confirm }) => {
      confirm = options.success;
    });
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal,
      navigateTo: vi.fn(),
      showToast: vi.fn(),
    });
    vi.mocked(consumerToken).mockReturnValue('consumer-session');
    vi.mocked(storedConsumerId).mockReturnValue(rentalConsumer);
    vi.mocked(randomId).mockReturnValue(rentalKey);
    vi.mocked(createRental).mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      consumerUserId: rentalConsumer,
      storeId: rentalStore,
      items: [{ skuId: rentalSku, quantity: 1 }],
    } as never);
    const event = {
      currentTarget: { dataset: { storeId: rentalStore, skuId: rentalSku } },
    } as never;
    const search = page();
    search.data.items = [reservationItem()];
    const first = search.reserveRental(event);
    await search.reserveRental(event);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(createRental).not.toHaveBeenCalled();
    expect(search.data.reserving).toBe(true);
    confirm({ confirm: true });
    await first;
    expect(createRental).toHaveBeenCalledTimes(1);
    expect(search.data.reserving).toBe(false);
  });

  it('reuses one persisted rental request key after a lost response and blocks double taps', async () => {
    const storage = new Map<string, unknown>();
    const navigateTo = vi.fn();
    const showToast = vi.fn();
    const showModal = vi.fn((options: { success: (result: { confirm: boolean }) => void }) =>
      options.success({ confirm: true }),
    );
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal,
      navigateTo,
      showToast,
    });
    vi.mocked(consumerToken).mockReturnValue('consumer-session');
    vi.mocked(storedConsumerId).mockReturnValue(rentalConsumer);
    vi.mocked(randomId).mockReturnValue(rentalKey);
    vi.mocked(createRental)
      .mockRejectedValueOnce(new Error('request:fail timeout'))
      .mockResolvedValueOnce({
        id: '55555555-5555-4555-8555-555555555555',
        consumerUserId: rentalConsumer,
        storeId: rentalStore,
        items: [{ skuId: rentalSku, quantity: 1 }],
      } as never);
    const event = {
      currentTarget: { dataset: { storeId: rentalStore, skuId: rentalSku } },
    } as never;
    const search = page();
    search.data.items = [reservationItem()];
    await search.reserveRental(event);
    expect(createRental).toHaveBeenCalledWith(rentalStore, rentalSku, rentalKey);
    expect(storage.size).toBe(1);

    await search.reserveRental(event);
    expect(createRental).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createRental).mock.calls[1]).toEqual(vi.mocked(createRental).mock.calls[0]);
    expect(storage.size).toBe(0);
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/rental-detail/rental-detail?id=55555555-5555-4555-8555-555555555555',
    });
    expect(showModal).toHaveBeenCalledTimes(2);
    expect(search.data.reserving).toBe(false);
  });

  it('refuses cross-account rental results and never clears a pending key without matching identity', async () => {
    const storage = new Map<string, unknown>();
    const navigateTo = vi.fn();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal: (options: { success: (result: { confirm: boolean }) => void }) =>
        options.success({ confirm: true }),
      navigateTo,
      showToast: vi.fn(),
    });
    vi.mocked(consumerToken).mockReturnValue('consumer-session');
    vi.mocked(storedConsumerId).mockReturnValue(rentalConsumer);
    vi.mocked(randomId).mockReturnValue(rentalKey);
    vi.mocked(createRental).mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      consumerUserId: '66666666-6666-4666-8666-666666666666',
      storeId: rentalStore,
      items: [{ skuId: rentalSku, quantity: 1 }],
    } as never);
    const search = page();
    search.data.items = [reservationItem()];
    await search.reserveRental({
      currentTarget: { dataset: { storeId: rentalStore, skuId: rentalSku } },
    } as never);
    expect(navigateTo).not.toHaveBeenCalled();
    expect(storage.size).toBe(1);
  });

  it('keeps the newest results when older catalog responses arrive late', async () => {
    let resolveOld: (value: Awaited<ReturnType<typeof searchInventory>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    read.mockResolvedValueOnce([inventoryItem('new', 'https://bos.invalid/new.jpg')] as never);
    const search = page();
    search.data.query = 'old';
    const oldSearch = search.submitSearch();
    search.data.query = 'new';
    await search.submitSearch();
    resolveOld([inventoryItem('old', 'https://bos.invalid/old.jpg')] as never);
    await oldSearch;

    expect(search.data.items).toMatchObject([
      { key: 'sku-new:store-new', displayCoverUrl: 'https://bos.invalid/new.jpg' },
    ]);
    expect(search.data.errorMessage).toBe('');
    expect(search.data.loading).toBe(false);
    expect(read).toHaveBeenNthCalledWith(1, expect.objectContaining({ q: 'old' }));
    expect(read).toHaveBeenNthCalledWith(2, expect.objectContaining({ q: 'new' }));
  });

  it('ignores stale search errors after a newer result succeeds', async () => {
    let rejectOld: (reason: Error) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    read.mockResolvedValueOnce([inventoryItem('fresh', 'https://bos.invalid/fresh.jpg')] as never);
    const search = page();
    const oldSearch = search.submitSearch();
    await search.submitSearch();
    rejectOld(new Error('request:fail timeout'));
    await oldSearch;

    expect(search.data.items[0]?.key).toBe('sku-fresh:store-fresh');
    expect(search.data.errorMessage).toBe('');
    expect(search.data.loading).toBe(false);
  });

  it('does not re-enable nearby after the user cancels a pending location request', async () => {
    let locationReady: (location: { latitude: number; longitude: number }) => void = () => {};
    vi.stubGlobal('wx', {
      getLocation: (options: { success: typeof locationReady }) => {
        locationReady = options.success;
      },
    });
    const search = page();
    const pending = search.useNearby();
    await search.disableNearby();
    locationReady({ latitude: 30.6, longitude: 104.1 });
    await pending;

    expect(search.data.nearbyMode).toBe(false);
    expect(search.data.latitude).toBeNull();
    expect(search.data.longitude).toBeNull();
    expect(search.data.loading).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps searching until nearby results arrive, using the accepted location only', async () => {
    vi.stubGlobal('wx', {
      getLocation: (options: { success: (location: unknown) => void }) =>
        options.success({ latitude: 30.6, longitude: 104.1 }),
    });
    let resolveSearch: (value: Awaited<ReturnType<typeof searchInventory>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const search = page();
    const pending = search.useNearby();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(search.data.loading).toBe(true);
    resolveSearch([inventoryItem('nearby', 'https://bos.invalid/nearby.jpg')] as never);
    await pending;

    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 30.6, longitude: 104.1, radiusKm: 50 }),
    );
    expect(search.data.nearbyMode).toBe(true);
    expect(search.data.loading).toBe(false);
  });

  it('ignores an in-flight inventory result after page unload', async () => {
    let resolveRead: (value: Awaited<ReturnType<typeof searchInventory>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const search = page();
    const pending = search.submitSearch();
    search.onUnload();
    resolveRead([inventoryItem('stale', 'https://bos.invalid/stale.jpg')] as never);
    await pending;

    expect(search.pageClosed).toBe(true);
    expect(search.data.items).toEqual([]);
  });

  it('discards hidden search results and fetches fresh inventory on return', async () => {
    const search = page();
    search.data.searched = true;
    let releaseOld: (value: Awaited<ReturnType<typeof searchInventory>>) => void = () => {};
    read.mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)));
    read.mockResolvedValueOnce([inventoryItem('fresh', 'https://bos.invalid/fresh.jpg')] as never);
    const oldRequest = search.submitSearch();
    search.onHide();
    expect(search.data.items).toEqual([]);
    search.onShow();
    await vi.waitFor(() => expect(search.data.items[0]?.key).toBe('sku-fresh:store-fresh'));
    releaseOld([inventoryItem('old', 'https://bos.invalid/old.jpg')] as never);
    await oldRequest;
    expect(search.data.items[0]?.key).toBe('sku-fresh:store-fresh');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('only opens loaded, currently visible store and sale product rows', () => {
    const navigateTo = vi.fn();
    vi.stubGlobal('wx', { navigateTo });
    const search = page();
    search.data.items = [reservationItem()];
    search.openStore({ currentTarget: { dataset: { id: 'other-store' } } } as never);
    search.openProduct({ currentTarget: { dataset: { id: 'other-product' } } } as never);
    expect(navigateTo).not.toHaveBeenCalled();
    search.openStore({ currentTarget: { dataset: { id: rentalStore } } } as never);
    search.openProduct({
      currentTarget: { dataset: { id: 'product-reservation' } },
    } as never);
    expect(navigateTo).toHaveBeenCalledTimes(2);
    search.data.loading = true;
    search.openStore({ currentTarget: { dataset: { id: rentalStore } } } as never);
    expect(navigateTo).toHaveBeenCalledTimes(2);
    search.onHide();
    search.openProduct({
      currentTarget: { dataset: { id: 'product-reservation' } },
    } as never);
    expect(navigateTo).toHaveBeenCalledTimes(2);
  });

  it('rejects an invented rental row and a stale confirmation after search changes', async () => {
    const storage = new Map<string, unknown>();
    let confirm: (result: { confirm: boolean }) => void = () => {};
    const showModal = vi.fn((options: { success: typeof confirm }) => {
      confirm = options.success;
    });
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal,
      showToast: vi.fn(),
    });
    vi.mocked(consumerToken).mockReturnValue('consumer-session');
    vi.mocked(storedConsumerId).mockReturnValue(rentalConsumer);
    const search = page();
    const event = {
      currentTarget: { dataset: { storeId: rentalStore, skuId: rentalSku } },
    } as never;
    await search.reserveRental(event);
    expect(showModal).not.toHaveBeenCalled();
    search.data.items = [reservationItem()];
    const pending = search.reserveRental(event);
    expect(showModal).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce([inventoryItem('other', 'https://bos.invalid/other.jpg')] as never);
    await search.submitSearch();
    confirm({ confirm: true });
    await pending;
    expect(createRental).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it('never navigates after a hidden rental write and requires review on returning', async () => {
    const storage = new Map<string, unknown>();
    const navigateTo = vi.fn();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      showModal: (options: { success: (result: { confirm: boolean }) => void }) =>
        options.success({ confirm: true }),
      navigateTo,
      showToast: vi.fn(),
    });
    vi.mocked(consumerToken).mockReturnValue('consumer-session');
    vi.mocked(storedConsumerId).mockReturnValue(rentalConsumer);
    vi.mocked(randomId).mockReturnValue(rentalKey);
    let releaseWrite: (value: Awaited<ReturnType<typeof createRental>>) => void = () => {};
    vi.mocked(createRental).mockImplementationOnce(
      () => new Promise((resolve) => (releaseWrite = resolve)),
    );
    const search = page();
    search.data.items = [reservationItem()];
    const pending = search.reserveRental({
      currentTarget: { dataset: { storeId: rentalStore, skuId: rentalSku } },
    } as never);
    await vi.waitFor(() => expect(createRental).toHaveBeenCalledOnce());
    search.onHide();
    search.onShow();
    releaseWrite({
      id: '55555555-5555-4555-8555-555555555555',
      consumerUserId: rentalConsumer,
      storeId: rentalStore,
      items: [{ skuId: rentalSku, quantity: 1 }],
    } as never);
    await pending;
    expect(navigateTo).not.toHaveBeenCalled();
    expect(search.data.errorMessage).toContain('核对');
    expect(search.reservationNeedsReview).toBe(true);
    expect(storage.size).toBe(0);
  });
});
