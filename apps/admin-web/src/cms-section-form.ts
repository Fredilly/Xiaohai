import { cmsSectionInputSchema, type CmsSection, type CmsSectionInput } from '@xiaohai/contracts';

export type CmsSectionFormValues = {
  sectionType: CmsSectionInput['sectionType'];
  title: string;
  subtitle: string;
  displayOrder: string;
  enabled: boolean;
  publicationState: CmsSectionInput['publicationState'];
  configJson: string;
  mediaUrl: string;
  actionJson: string;
};

export function formValuesFromSection(section: CmsSection): CmsSectionFormValues {
  return {
    sectionType: section.sectionType,
    title: section.title,
    subtitle: section.subtitle ?? '',
    displayOrder: String(section.displayOrder),
    enabled: section.enabled,
    publicationState: section.publicationState,
    configJson: JSON.stringify(section.config, null, 2),
    mediaUrl: section.mediaUrl ?? '',
    actionJson: section.action ? JSON.stringify(section.action, null, 2) : '',
  };
}

export function newSectionFormValues(displayOrder: number): CmsSectionFormValues {
  return {
    sectionType: 'BANNER',
    title: '新运营位',
    subtitle: '',
    displayOrder: String(displayOrder),
    enabled: true,
    publicationState: 'DRAFT',
    configJson: defaultConfigJson('BANNER'),
    mediaUrl: '',
    actionJson: '',
  };
}

export function defaultConfigJson(sectionType: CmsSectionInput['sectionType']): string {
  const config: Record<CmsSectionInput['sectionType'], object> = {
    HERO: {},
    FEATURE_GRID: { items: [] },
    CONTENT_LIST: { items: [] },
    BANNER: { body: '请编辑运营内容' },
  };
  return JSON.stringify(config[sectionType], null, 2);
}

export function parseCmsSectionForm(values: CmsSectionFormValues): CmsSectionInput {
  const config = parseJson('config', values.configJson);
  const action = values.actionJson.trim() ? parseJson('action', values.actionJson) : null;
  return cmsSectionInputSchema.parse({
    sectionType: values.sectionType,
    title: values.title,
    subtitle: values.subtitle.trim() || null,
    displayOrder: Number(values.displayOrder),
    enabled: values.enabled,
    publicationState: values.publicationState,
    config,
    mediaUrl: values.mediaUrl.trim() || null,
    action,
  });
}

function parseJson(label: string, value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    throw new Error(`${label} 必须是有效 JSON`);
  }
}
