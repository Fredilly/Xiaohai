import type { Product } from '../services/commerce';
import { resolveEditorialBookCover } from './real-visuals';

export type DisplayProduct = Product & {
  isBook: boolean;
  displayCoverUrl: string;
  galleryUrls: string[];
  displaySubtitle: string;
  displayPriceText: string;
};

/**
 * A non-book merchandise product has no book edition. Do not infer book identity
 * from a matching product name: editorial fallback covers belong to books only.
 */
export function presentCatalogProduct(product: Product): DisplayProduct {
  const isBook = Boolean(product.title || product.author || product.isbn || product.publisher);
  const displayCoverUrl = isBook
    ? resolveEditorialBookCover(product.title ?? product.name, product.coverUrl)
    : (product.coverUrl?.trim() ?? '');

  const displaySubtitle = isBook
    ? (product.author ?? product.publisher ?? '图书商品')
    : product.skus.length > 1
      ? `${product.skus.length} 种规格`
      : (product.skus[0]?.name ?? '商品详情');

  // A disabled SKU must not set an enticing "starting from" price.
  // Physical store stock is a separate server-side checkout decision.
  const purchasableSkus = product.skus.filter((sku) => sku.availableForSale);
  const lowestPrice = purchasableSkus.reduce<number | null>(
    (min, sku) => (min === null ? sku.priceMinor : Math.min(min, sku.priceMinor)),
    null,
  );
  const displayPriceText =
    lowestPrice === null
      ? product.skus.length === 0
        ? '暂无报价'
        : '暂不可购买'
      : `¥${(lowestPrice / 100).toFixed(2)}${purchasableSkus.length > 1 ? ' 起' : ''}`;

  const galleryUrls = [...new Set([displayCoverUrl, ...(product.mediaUrls ?? [])].filter(Boolean))];
  return { ...product, isBook, displayCoverUrl, galleryUrls, displaySubtitle, displayPriceText };
}
