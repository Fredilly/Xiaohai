import { describe, expect, it } from 'vitest';
import { parseCmsSectionForm, type CmsSectionFormValues } from './cms-section-form';

const validValues: CmsSectionFormValues = {
  sectionType: 'BANNER',
  title: '运营 Banner',
  subtitle: '副标题',
  displayOrder: '3',
  enabled: false,
  publicationState: 'PUBLISHED',
  configJson: '{"body":"正式内容"}',
  mediaUrl: 'https://example.com/banner.jpg',
  actionJson: '{"type":"PREVIEW","target":"shop"}',
};

describe('M4 CMS section form', () => {
  it('validates and maps all editable fields before API submission', () => {
    expect(parseCmsSectionForm(validValues)).toEqual({
      sectionType: 'BANNER',
      title: '运营 Banner',
      subtitle: '副标题',
      displayOrder: 3,
      enabled: false,
      publicationState: 'PUBLISHED',
      config: { body: '正式内容' },
      mediaUrl: 'https://example.com/banner.jpg',
      action: { type: 'PREVIEW', target: 'shop' },
    });
  });

  it('does not allow malformed config JSON to reach the API', () => {
    expect(() => parseCmsSectionForm({ ...validValues, configJson: '{bad json' })).toThrow(
      'config 必须是有效 JSON',
    );
  });

  it('uses the shared contract to reject config that does not match the section type', () => {
    expect(() =>
      parseCmsSectionForm({
        ...validValues,
        sectionType: 'FEATURE_GRID',
        configJson: '{"body":"wrong shape"}',
      }),
    ).toThrow();
  });

  it('uses the shared contract to reject invalid action JSON structure', () => {
    expect(() =>
      parseCmsSectionForm({ ...validValues, actionJson: '{"type":"EXTERNAL","target":"shop"}' }),
    ).toThrow();
  });
});
