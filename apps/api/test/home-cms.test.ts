import { describe, expect, it } from 'vitest';
import { cmsSectionInputSchema, publicHomeResponseSchema } from '@xiaohai/contracts';

describe('M4 CMS contracts', () => {
  it('rejects unknown section types and mismatched structured config', () => {
    expect(
      cmsSectionInputSchema.safeParse({
        sectionType: 'UNKNOWN',
        title: 'bad',
        displayOrder: 0,
        enabled: true,
        publicationState: 'DRAFT',
        config: {},
      }).success,
    ).toBe(false);
    expect(
      cmsSectionInputSchema.safeParse({
        sectionType: 'FEATURE_GRID',
        title: 'bad config',
        displayOrder: 0,
        enabled: true,
        publicationState: 'DRAFT',
        config: { items: [{ nope: true }] },
      }).success,
    ).toBe(false);
  });

  it('keeps the public contract free of admin-only publication metadata', () => {
    const parsed = publicHomeResponseSchema.parse({
      page: { key: 'HOME', title: '首页' },
      sections: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sectionType: 'BANNER',
          title: '活动',
          subtitle: null,
          displayOrder: 0,
          config: { body: 'hello' },
          mediaUrl: null,
          action: null,
        },
      ],
    });
    expect(parsed.sections[0]).not.toHaveProperty('publicationState');
    expect(parsed.sections[0]).not.toHaveProperty('version');
  });
});
