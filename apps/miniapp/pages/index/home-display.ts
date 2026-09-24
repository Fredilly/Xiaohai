import type { HomeSection } from '../../services/home';
import { HOME_EDITORIAL_FALLBACK } from '../../utils/real-visuals';

// Historical local CMS seeds may still contain internal milestone labels.
// Keep the CMS badge field for editorial labels while hiding release codes.
// A media-less HERO uses the curated BOS editorial fallback; explicit CMS media
// always wins so operators can replace the default artwork without code changes.
export function homeDisplaySections(sections: HomeSection[]): HomeSection[] {
  return sections.map((section) => {
    if (section.sectionType === 'HERO' && !section.mediaUrl) {
      return { ...section, mediaUrl: HOME_EDITORIAL_FALLBACK };
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
