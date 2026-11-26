import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { listProducts } from '../../services/commerce';

vi.mock('../../services/commerce', () => ({ listProducts: vi.fn() }));
vi.mock('../../utils/real-visuals', () => ({
  resolveEditorialBookCover: (_title: string, url: string | null) => url ?? '',
}));

type ShopPage = {
  data: {
    q: string;
    products: Array<{ id: string; displayCoverUrl: string }>;
    loading: boolean;
    error: boolean;
  };
  requestVersion: number;
  pageClosed: boolean;
  setData(changes: Record<string, unknown>): void;
  load(): Promise<void>;
  onUnload(): void;
};

const read = vi.mocked(listProducts);
let definition: ShopPage;

function item(id: string, coverUrl: string) {
  return { id, name: id, title: id, coverUrl, skus: [{ priceMinor: 990 }] };
}

function page(): ShopPage {
  return {
    ...definition,
    data: { q: '', products: [], loading: true, error: false },
    requestVersion: 0,
    pageClosed: false,
    setData(changes: Record<string, unknown>) {
      Object.assign(this.data, changes);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: ShopPage) => {
    definition = options;
  });
  await import('./shop');
});
afterEach(() => vi.resetAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe('shop catalog and BOS image recovery (#70)', () => {
  it('keeps the newest search and cover after responses return out of order', async () => {
    let resolveOld: (value: Awaited<ReturnType<typeof listProducts>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    read.mockResolvedValueOnce({
      products: [item('new-book', 'https://bos.invalid/new.jpg')],
    } as never);
    const shop = page();

    shop.data.q = 'old';
    const oldSearch = shop.load();
    shop.data.q = 'new';
    await shop.load();
    resolveOld({ products: [item('old-book', 'https://bos.invalid/expired.jpg')] } as never);
    await oldSearch;

    expect(read).toHaveBeenNthCalledWith(1, 'old');
    expect(read).toHaveBeenNthCalledWith(2, 'new');
    expect(shop.data.products).toMatchObject([
      { id: 'new-book', displayCoverUrl: 'https://bos.invalid/new.jpg' },
    ]);
    expect(shop.data.loading).toBe(false);
    expect(shop.data.error).toBe(false);
  });

  it('ignores a stale search failure after a later successful response', async () => {
    let rejectOld: (reason: Error) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    read.mockResolvedValueOnce({
      products: [item('new-book', 'https://bos.invalid/new.jpg')],
    } as never);
    const shop = page();

    const oldSearch = shop.load();
    await shop.load();
    rejectOld(new Error('request timeout'));
    await oldSearch;

    expect(shop.data.products[0]?.id).toBe('new-book');
    expect(shop.data.error).toBe(false);
  });

  it('ignores late data when the storefront page has been unloaded', async () => {
    let resolveRead: (value: Awaited<ReturnType<typeof listProducts>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const shop = page();
    const pending = shop.load();
    shop.onUnload();
    resolveRead({ products: [item('unmounted', 'https://bos.invalid/old.jpg')] } as never);
    await pending;

    expect(shop.pageClosed).toBe(true);
    expect(shop.data.products).toEqual([]);
  });
});
