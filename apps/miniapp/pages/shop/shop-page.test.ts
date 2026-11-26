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
  wasHidden: boolean;
  setData(changes: Record<string, unknown>): void;
  load(): Promise<void>;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  open(event: WechatMiniprogram.TouchEvent): void;
  coverError(event: WechatMiniprogram.TouchEvent): void;
  cart(): void;
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
    wasHidden: false,
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
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
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

  it('refreshes catalog after returning and never displays an old hidden request', async () => {
    let releaseOld: (value: Awaited<ReturnType<typeof listProducts>>) => void = () => {};
    read.mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)));
    read.mockResolvedValueOnce({
      products: [item('new-product', 'https://bos.example.com/new.jpg')],
    } as never);
    const shop = page();
    shop.data.q = 'storybook';
    const pending = shop.load();
    shop.onHide();
    shop.onShow();
    await vi.waitFor(() => expect(shop.data.products[0]?.id).toBe('new-product'));
    releaseOld({ products: [item('old-product', 'https://bos.example.com/old.jpg')] } as never);
    await pending;
    expect(shop.data.products[0]?.id).toBe('new-product');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never opens an invented or outdated product from the catalog row', () => {
    const shop = page();
    shop.data.products = [{ id: 'current-id', displayCoverUrl: '' }];
    shop.data.loading = false;
    const navigateTo = vi.fn();
    vi.stubGlobal('wx', { navigateTo });
    shop.open({ currentTarget: { dataset: { id: 'old-id' } } } as never);
    expect(navigateTo).not.toHaveBeenCalled();
    shop.open({ currentTarget: { dataset: { id: 'current-id' } } } as never);
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/product/product?id=current-id' });
    shop.onHide();
    shop.open({ currentTarget: { dataset: { id: 'current-id' } } } as never);
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it('clears previous search results when a newer search starts', async () => {
    const shop = page();
    shop.data.products = [{ id: 'old-product', displayCoverUrl: '' }];
    shop.data.loading = false;
    let release: (value: Awaited<ReturnType<typeof listProducts>>) => void = () => {};
    read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = shop.load();
    expect(shop.data.products).toEqual([]);
    expect(shop.data.loading).toBe(true);
    release({ products: [item('new-product', 'https://bos.example.com/new.jpg')] } as never);
    await pending;
    expect(shop.data.products[0]?.id).toBe('new-product');
  });

  it('prevents image callbacks and navigation after storefront disposal', () => {
    const shop = page();
    shop.data.products = [{ id: 'current-id', displayCoverUrl: 'https://bos.example.com/x.jpg' }];
    shop.data.loading = false;
    const navigateTo = vi.fn();
    vi.stubGlobal('wx', { navigateTo });
    shop.onUnload();
    shop.open({ currentTarget: { dataset: { id: 'current-id' } } } as never);
    shop.cart();
    shop.coverError({
      currentTarget: {
        dataset: { id: 'current-id', index: 0, src: 'https://bos.example.com/x.jpg' },
      },
    } as never);
    shop.onShow();
    expect(shop.data.products).toEqual([]);
    expect(navigateTo).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
