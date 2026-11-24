import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { searchInventory } from '../../services/inventory';

vi.mock('../../services/inventory', () => ({ searchInventory: vi.fn() }));
vi.mock('../../services/rental', () => ({ createRental: vi.fn() }));

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
    items: Array<{ key: string; displayCoverUrl: string }>;
  };
  searchRequestVersion: number;
  locationRequestVersion: number;
  pageClosed: boolean;
  setData(changes: Record<string, unknown>): void;
  submitSearch(): Promise<void>;
  useNearby(): Promise<void>;
  disableNearby(): Promise<void>;
  onUnload(): void;
};

const read = vi.mocked(searchInventory);
let definition: SearchPage;

function inventoryItem(id: string, cover: string) {
  return {
    sku: { id: `sku-${id}`, priceMinor: 1200 },
    book: { title: id },
    product: { coverUrl: cover },
    store: { id: `store-${id}`, distanceKm: null },
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
    },
    searchRequestVersion: 0,
    locationRequestVersion: 0,
    pageClosed: false,
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
});
