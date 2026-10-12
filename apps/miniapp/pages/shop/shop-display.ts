/**
 * Keep a complete catalog row when its remote cover fails in WeChat.
 *
 * A late image error may arrive after a search refresh or list reorder.
 * Only clear a cover when both the row identity and failing URL still match.
 */
export function clearFailedShopCover<T extends { id: string; displayCoverUrl: string }>(
  products: T[],
  index: number,
  productId: string,
  failedUrl: string,
): T[] {
  if (!Number.isInteger(index) || index < 0 || !productId || !failedUrl) return products;
  const current = products[index];
  if (!current || current.id !== productId || current.displayCoverUrl !== failedUrl) {
    return products;
  }
  return products.map((product, position) =>
    position === index ? { ...product, displayCoverUrl: '' } : product,
  );
}
