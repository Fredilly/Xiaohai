import { resolveEditorialBookCover } from '../../utils/real-visuals';

type BookSearchCoverSource = {
  book: { title: string };
  product: { coverUrl: string | null };
};

export function resolveBookSearchCover(item: BookSearchCoverSource) {
  return resolveEditorialBookCover(item.book.title, item.product.coverUrl);
}

/**
 * A late image error may arrive after another search, a result reorder, or a URL refresh.
 * Clear the cover only when the rendered row identity and URL still match the event.
 */
export function clearFailedBookSearchCover<T extends { key: string; displayCoverUrl: string }>(
  items: T[],
  index: number,
  itemKey: string,
  failedUrl: string,
): T[] {
  if (!Number.isInteger(index) || index < 0 || !itemKey || !failedUrl) return items;
  const current = items[index];
  if (!current || current.key !== itemKey || current.displayCoverUrl !== failedUrl) return items;

  return items.map((item, position) =>
    position === index ? { ...item, displayCoverUrl: '' } : item,
  );
}
