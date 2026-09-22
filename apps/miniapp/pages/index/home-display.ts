import type { HomeSection } from '../../services/home';

// Historical local CMS seeds may still contain internal milestone labels.
// Keep the CMS badge field for editorial labels while hiding release codes.
export function homeDisplaySections(sections: HomeSection[]): HomeSection[] {
  return sections.map((section) => {
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
