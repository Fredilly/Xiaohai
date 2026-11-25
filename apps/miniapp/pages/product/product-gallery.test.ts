import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCartItem } from '../../services/commerce';

const mocks = vi.hoisted(() => ({ getProduct: vi.fn() }));
vi.mock('../../services/commerce', () => ({ getProduct: mocks.getProduct, addCartItem: vi.fn() }));
vi.mock('../../utils/real-visuals', () => ({
  resolveEditorialBookCover: (_title: string, url: string | null) => url ?? '',
}));

type Detail = {
  id: string;
  gallery: Array<{ key: number; url: string }>;
  skus?: Array<{ id: string; availableForSale: boolean }>;
};
type PageConfig = {
  addInFlight: boolean;
  data: { product: Detail | null; [key: string]: unknown };
  setData(changes: Record<string, unknown>): void;
  load(id: string): Promise<void>;
  galleryError(event: WechatMiniprogram.TouchEvent): void;
  add(event: WechatMiniprogram.TouchEvent): Promise<void>;
};
let definition: PageConfig;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: PageConfig) => {
    definition = page;
  });
  await import('./product');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

function makePage() {
  const instance: PageConfig = {
    ...definition,
    addInFlight: false,
    data: { ...definition.data },
    setData(changes) {
      for (const [field, value] of Object.entries(changes)) {
        if (field === 'product.gallery') {
          if (instance.data.product) instance.data.product.gallery = value as Detail['gallery'];
        } else {
          instance.data[field] = value;
        }
      }
    },
  };
  return instance;
}

function failedImage(productId: string, index: number, src: string) {
  return {
    currentTarget: { dataset: { id: productId, index, src } },
  } as unknown as WechatMiniprogram.TouchEvent;
}

describe('product detail media gallery (#208)', () => {
  it('shows ordered detail media once without repeating the main cover', async () => {
    mocks.getProduct.mockResolvedValue({
      id: 'product-1',
      name: '真实食品',
      title: null,
      isbn: null,
      publisher: null,
      coverUrl: 'https://bos.example.com/main.jpg',
      mediaUrls: [
        'https://bos.example.com/main.jpg',
        'https://bos.example.com/detail-1.jpg',
        'https://bos.example.com/detail-1.jpg',
        'http://insecure.example.com/ignored.jpg',
        'https://bos.example.com/detail-2.jpg',
      ],
      skus: [],
    });
    const page = makePage();
    await page.load.call(page, 'product-1');
    expect(page.data.product?.gallery).toEqual([
      { key: 0, url: 'https://bos.example.com/detail-1.jpg' },
      { key: 1, url: 'https://bos.example.com/detail-2.jpg' },
    ]);

    page.galleryError.call(page, failedImage('product-1', 0, 'https://bos.example.com/old.jpg'));
    page.galleryError.call(
      page,
      failedImage('different-product', 0, 'https://bos.example.com/detail-1.jpg'),
    );
    expect(page.data.product?.gallery[0]?.url).toBe('https://bos.example.com/detail-1.jpg');

    page.galleryError.call(
      page,
      failedImage('product-1', 0, 'https://bos.example.com/detail-1.jpg'),
    );
    expect(page.data.product?.gallery).toEqual([
      { key: 0, url: '' },
      { key: 1, url: 'https://bos.example.com/detail-2.jpg' },
    ]);
  });

  it('does not expose fake ISBN placeholders on non-book products', () => {
    const template = readFileSync(new URL('./product.wxml', import.meta.url), 'utf8');
    expect(template).toContain('wx:if="{{product.isbn || product.publisher}}"');
    expect(template).not.toContain("product.isbn || '—'");
    expect(template).toContain('binderror="galleryError"');
    expect(template).toContain('wx:if="{{item.url}}"');
  });

  it('blocks double taps while a cart add is pending and preserves uncertain-write feedback', async () => {
    let rejectWrite: (reason: Error) => void = () => {};
    vi.mocked(addCartItem).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectWrite = reject;
        }),
    );
    const page = makePage();
    page.data.product = {
      id: 'product-1',
      gallery: [],
      skus: [{ id: 'sku-1', availableForSale: true }],
    };
    const event = {
      currentTarget: { dataset: { sku: 'sku-1' } },
    } as unknown as WechatMiniprogram.TouchEvent;
    const first = page.add.call(page, event);
    await page.add.call(page, event);
    expect(addCartItem).toHaveBeenCalledTimes(1);
    expect(page.data.addingSku).toBe('sku-1');
    rejectWrite(new Error('network timeout'));
    await first;
    expect(page.data.addingSku).toBe('');
    expect(page.data.message).toContain('未确认');
  });
});
