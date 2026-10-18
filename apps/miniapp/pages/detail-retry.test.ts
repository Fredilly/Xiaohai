import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getSeries: vi.fn(),
  getStore: vi.fn(),
  getRental: vi.fn(),
  setNavigationBarTitle: vi.fn(),
}));

vi.mock('../services/commerce', () => ({
  getProduct: mocks.getProduct,
  addCartItem: vi.fn(),
}));
vi.mock('../utils/real-visuals', () => ({
  resolveEditorialBookCover: () => '',
}));
vi.mock('../services/content', () => ({
  getSeries: mocks.getSeries,
}));
vi.mock('../services/stores', () => ({
  getStore: mocks.getStore,
}));
vi.mock('../services/rental', () => ({
  getRental: mocks.getRental,
  cancelRental: vi.fn(),
}));

type PageConfig = {
  data: Record<string, unknown>;
  setData(changes: Record<string, unknown>): void;
  load?(id?: string): Promise<void>;
  loadStore?(id: string): Promise<void>;
  retry?(): void;
};

const captured: PageConfig[] = [];

beforeAll(async () => {
  vi.stubGlobal('Page', (page: PageConfig) => {
    captured.push(page);
  });
  await import('./product/product');
  await import('./story-detail/story-detail');
  await import('./store-detail/store-detail');
  await import('./rental-detail/rental-detail');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { setNavigationBarTitle: mocks.setNavigationBarTitle });
});

function page(index: number): PageConfig {
  const definition = captured[index];
  if (!definition) throw new Error('Page module was not registered');
  const instance: PageConfig = {
    ...definition,
    data: { ...definition.data },
    setData(changes) {
      Object.assign(instance.data, changes);
    },
  };
  return instance;
}

describe('detail pages retry their original data reads', () => {
  it('retries the product ID after an API error and clears the error state', async () => {
    const instance = page(0);
    instance.data.id = 'product-1';
    mocks.getProduct.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      id: 'product-1',
      name: '测试图书',
      title: '测试图书',
      coverUrl: null,
      skus: [],
    });

    await instance.load?.call(instance, 'product-1');
    expect(instance.data.error).toBe(true);
    instance.retry?.call(instance);

    await vi.waitFor(() => {
      expect(mocks.getProduct).toHaveBeenCalledTimes(2);
      expect(instance.data.error).toBe(false);
      expect(instance.data.loading).toBe(false);
    });
  });

  it('retries the story series ID after an error without losing its route ID', async () => {
    const instance = page(1);
    instance.data.id = 'series-1';
    mocks.getSeries.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      id: 'series-1',
      title: '童话测试',
      episodes: [],
    });

    await instance.load?.call(instance, 'series-1');
    expect(instance.data.error).toBe('内容详情加载失败');
    instance.retry?.call(instance);

    await vi.waitFor(() => {
      expect(mocks.getSeries).toHaveBeenCalledTimes(2);
      expect(instance.data.error).toBe('');
      expect(instance.data.detail).toMatchObject({ id: 'series-1' });
    });
  });

  it('retries the same store and restores its real map marker data', async () => {
    const instance = page(2);
    instance.data.id = 'store-1';
    const store = { id: 'store-1', name: '隔离门店', latitude: 30.6, longitude: 104.1 };
    mocks.getStore.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(store);

    await instance.loadStore?.call(instance, 'store-1');
    expect(instance.data.error).toBe(true);
    instance.retry?.call(instance);

    await vi.waitFor(() => {
      expect(mocks.getStore).toHaveBeenCalledTimes(2);
      expect(instance.data.error).toBe(false);
      expect(instance.data.store).toMatchObject(store);
      expect(instance.data.markers).toMatchObject([{ latitude: 30.6, longitude: 104.1 }]);
    });
  });

  it('allows rental detail to reload after its initial protected read fails', async () => {
    const instance = page(3);
    instance.data.id = 'rental-1';
    mocks.getRental.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      id: 'rental-1',
      status: 'BORROWED',
      dueAt: null,
    });

    await instance.load?.call(instance);
    expect(instance.data.error).toBe('租借记录不存在或无法访问');
    await instance.load?.call(instance);

    expect(mocks.getRental).toHaveBeenCalledTimes(2);
    expect(instance.data.error).toBe('');
    expect(instance.data.rental).toMatchObject({ id: 'rental-1', statusText: '借阅中' });
  });
});
