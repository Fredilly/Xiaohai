import { miniappRemoteAssets } from '../src/config/assets';

export const HOME_EDITORIAL_FALLBACK = miniappRemoteAssets.home.parentChildReading;

const BOOK_COVER_BY_TITLE = [
  {
    matches: (title: string) => title.includes('dinosaurs need a big hand'),
    asset: miniappRemoteAssets.shop.dinosaursNeedBigHandCover,
  },
  {
    matches: (title: string) => title.includes('pew pew tiger'),
    asset: miniappRemoteAssets.shop.pewPewTigerCover,
  },
  {
    matches: (title: string) => title.includes('dodo') && title.includes('hairy day'),
    asset: miniappRemoteAssets.shop.dodosHairyDayCover,
  },
  {
    matches: (title: string) =>
      title.includes("yun's diary") || title.includes('yuns diary') || title.includes('归云日记'),
    asset: miniappRemoteAssets.shop.yunsDiaryCover,
  },
] as const;

function normalizeTitle(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export function resolveHomeEditorialFallback(
  title: string | null | undefined,
  subtitle: string | null | undefined,
) {
  const copy = normalizeTitle(`${title ?? ''} ${subtitle ?? ''}`);
  if (!copy) return '';
  if (copy.includes('亲子阅读') || copy.includes('亲子绘本') || copy.includes('绘本乐园')) {
    return HOME_EDITORIAL_FALLBACK;
  }
  return '';
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
