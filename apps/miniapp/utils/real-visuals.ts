export const HOME_EDITORIAL_FALLBACK = '/assets/brand/home-parent-reading.jpg';

const BOOK_COVER_BY_TITLE = [
  {
    matches: (title: string) => title.includes('pew pew tiger'),
    asset: '/assets/books/book-pew-pew-tiger.jpg',
  },
  {
    matches: (title: string) => title.includes('dodo') && title.includes('hairy day'),
    asset: '/assets/books/book-dodos-hairy-day.jpg',
  },
  {
    matches: (title: string) =>
      title.includes("yun's diary") || title.includes('yuns diary') || title.includes('归云日记'),
    asset: '/assets/books/book-yuns-diary.jpg',
  },
] as const;

function normalizeTitle(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export function resolveEditorialBookCover(
  title: string | null | undefined,
  remoteCoverUrl: string | null | undefined,
) {
  const remote = remoteCoverUrl?.trim();
  if (remote) return remote;

  const normalized = normalizeTitle(title);
  if (!normalized) return '';
  return BOOK_COVER_BY_TITLE.find(({ matches }) => matches(normalized))?.asset ?? '';
}
