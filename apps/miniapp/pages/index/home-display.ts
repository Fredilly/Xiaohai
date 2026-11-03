import type { HomeSection } from '../../services/home';
import { resolveHomeEditorialFallback } from '../../utils/real-visuals';

// Historical local CMS seeds may still contain internal milestone labels.
// Keep the CMS badge field for editorial labels while hiding release codes.
// Only a matching parent-child-reading HERO uses the curated BOS editorial art.
// Keep unrelated media-less heroes free of mismatched photos, and let CMS media win.
export function homeDisplaySections(sections: HomeSection[]): HomeSection[] {
  return sections.map((section) => {
    if (section.sectionType === 'HERO' && !section.mediaUrl) {
      const fallback = resolveHomeEditorialFallback(section.title, section.subtitle);
      return fallback ? { ...section, mediaUrl: fallback } : section;
    }
    if (section.sectionType !== 'FEATURE_GRID' || !Array.isArray(section.config.items))
      return section;
    return {
      ...section,
      config: {
        ...section.config,
        items: section.config.items.map((value: unknown) => {
          if (!value || typeof value !== 'object') return value;
          const entry = value as Record<string, unknown>;
          const badge = entry.badge;
          if (typeof badge !== 'string' || !/^M\d+$/i.test(badge.trim())) return value;
          const publicEntry = { ...entry };
          delete publicEntry.badge;
          return publicEntry;
        }),
      },
    };
  });
}

/**
 * Ignore stale image errors from a previous CMS load or a recycled list row.
 * Replace the entire matching section to preserve its id, type, title and config.
 */
export function clearFailedHeroMedia(
  sections: HomeSection[],
  index: number,
  failedUrl: string,
): HomeSection[] {
  if (!Number.isInteger(index) || index < 0 || !failedUrl) return sections;
  const current = sections[index];
  if (current?.sectionType !== 'HERO' || current.mediaUrl !== failedUrl) return sections;
  return sections.map((section, position) =>
    position === index ? { ...section, mediaUrl: '' } : section,
  );
}
