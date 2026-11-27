import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchInventory } from '../../services/inventory';
import { getStore } from '../../services/stores';

vi.mock('../../services/inventory', () => ({ searchInventory: vi.fn() }));
vi.mock('../../services/stores', () => ({ getStore: vi.fn() }));

const inventory = vi.mocked(searchInventory);
const storeRead = vi.mocked(getStore);
const navigateTo = vi.fn();
const setNavigationBarTitle = vi.fn();

const store = { id: 'store-a', name: '东门', latitude: 30.5, longitude: 104.1 };
const book = {
  store: { id: 'store-a' },
  book: { title: '测试书', author: '测试作者', isbn: '9780000000002' },
  sku: { id: 'sku-a', priceMinor: 100 },
  product: { id: 'product-a' },
  stock: { available: 2 },
  sellAvailable: true,
  rentAvailable: true,
};

type StorePage = {
  readSequence: number;
  inventorySequence: number;
  wasHidden: boolean;
  pageClosed: boolean;
  data: {
    id: string;
    store: typeof store | null;
    loading: boolean;
    inventoryQuery: string;
    inventoryLoading: boolean;
    inventoryError: boolean;
    inventoryItems: Array<{ productId: string; available: number; priceText: string }>;
  };
  setData(patch: Record<string, unknown>): void;
  onLoad(query: Record<string, string>): void;
  onHide(): void;
  onShow(): void;
  onUnload(): void;
  onInventoryQueryInput(event: { detail: { value: string } }): void;
  searchStoreBooks(): void;
  openInventoryProduct(event: { currentTarget: { dataset: { id: string } } }): void;
};

let definition: StorePage;
beforeAll(async () => {
  vi.stubGlobal('Page', (options: StorePage) => {
    definition = options;
  });
  vi.stubGlobal('wx', { navigateTo, setNavigationBarTitle });
  await import('./store-detail');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  storeRead.mockResolvedValue(store as never);
  inventory.mockResolvedValue([book] as never);
});

function page(): StorePage {
  return {
    ...definition,
    readSequence: 0,
    inventorySequence: 0,
    wasHidden: false,
    pageClosed: false,
    data: { ...definition.data, inventoryItems: [] },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

describe('Public inventory in store detail', () => {
  it('reads stock scoped to the actual store and opens only a sellable listed product', async () => {
    const current = page();
    current.onLoad({ id: 'store-a' });
    await vi.waitFor(() => expect(current.data.inventoryItems).toHaveLength(1));

    expect(inventory).toHaveBeenCalledExactlyOnceWith({
      storeId: 'store-a',
      q: undefined,
      limit: 30,
    });
    expect(current.data.inventoryItems[0]).toMatchObject({
      productId: 'product-a',
      available: 2,
      priceText: '¥1.00',
    });
    current.openInventoryProduct({ currentTarget: { dataset: { id: 'other-product' } } });
    expect(navigateTo).not.toHaveBeenCalled();
    current.openInventoryProduct({ currentTarget: { dataset: { id: 'product-a' } } });
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith({
      url: '/pages/product/product?id=product-a',
    });
  });

  it('fails closed if the inventory API returns another store’s stock', async () => {
    inventory.mockResolvedValueOnce([{ ...book, store: { id: 'store-b' } }] as never);
    const current = page();
    current.onLoad({ id: 'store-a' });
    await vi.waitFor(() => expect(current.data.inventoryError).toBe(true));
    expect(current.data.inventoryItems).toEqual([]);
    current.openInventoryProduct({ currentTarget: { dataset: { id: 'product-a' } } });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('keeps the newest book query when responses complete out of order', async () => {
    const current = page();
    current.onLoad({ id: 'store-a' });
    await vi.waitFor(() => expect(current.data.inventoryItems).toHaveLength(1));

    let resolveOld!: (value: Awaited<ReturnType<typeof searchInventory>>) => void;
    inventory.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)));
    inventory.mockResolvedValueOnce([]);
    current.onInventoryQueryInput({ detail: { value: '第一本' } });
    current.searchStoreBooks();
    current.onInventoryQueryInput({ detail: { value: '第二本' } });
    current.searchStoreBooks();
    await vi.waitFor(() => expect(current.data.inventoryLoading).toBe(false));
    resolveOld([book] as never);
    await Promise.resolve();
    expect(current.data.inventoryItems).toEqual([]);
    expect(inventory).toHaveBeenLastCalledWith({ storeId: 'store-a', q: '第二本', limit: 30 });
  });

  it('discards old results while hidden and refreshes on return without leaking stale stock', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof searchInventory>>) => void;
    inventory.mockImplementationOnce(() => new Promise((accept) => (resolve = accept)));
    const current = page();
    current.onLoad({ id: 'store-a' });
    await vi.waitFor(() => expect(inventory).toHaveBeenCalledOnce());
    current.onHide();
    resolve([book] as never);
    await Promise.resolve();
    expect(current.data.inventoryItems).toEqual([]);
    expect(current.data.inventoryLoading).toBe(false);

    current.onShow();
    await vi.waitFor(() => expect(current.data.inventoryItems).toHaveLength(1));
    expect(inventory).toHaveBeenCalledTimes(2);
    current.onUnload();
    current.openInventoryProduct({ currentTarget: { dataset: { id: 'product-a' } } });
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
