import { getApiBaseUrl } from '../config';

export type HomeSection = {
  id: string;
  sectionType: 'HERO' | 'FEATURE_GRID' | 'CONTENT_LIST' | 'BANNER';
  title: string;
  subtitle?: string | null;
  displayOrder: number;
  config: Record<string, unknown>;
  mediaUrl?: string | null;
  action?: { type: 'PREVIEW'; target: string } | null;
};

export type HomeResponse = { page: { key: 'HOME'; title: string }; sections: HomeSection[] };

export async function getPublicHome(): Promise<HomeResponse> {
  const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
    (resolve, reject) => {
      wx.request({
        url: `${getApiBaseUrl()}/api/v1/home`,
        method: 'GET',
        success: resolve,
        fail: reject,
      });
    },
  );
  if (response.statusCode !== 200) throw new Error('Home load failed');
  return normalizeHomeResponse(response.data);
}

export function normalizeHomeResponse(value: unknown): HomeResponse {
  if (!isHomeResponse(value)) throw new Error('Invalid home response');
  return {
    page: value.page,
    sections: value.sections.filter(isKnownSection).sort((a, b) => a.displayOrder - b.displayOrder),
  };
}

function isHomeResponse(value: unknown): value is HomeResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HomeResponse>;
  return (
    candidate.page?.key === 'HOME' &&
    typeof candidate.page.title === 'string' &&
    Array.isArray(candidate.sections)
  );
}

function isKnownSection(value: unknown): value is HomeSection {
  if (!value || typeof value !== 'object') return false;
  const section = value as Partial<HomeSection>;
  return (
    typeof section.id === 'string' &&
    ['HERO', 'FEATURE_GRID', 'CONTENT_LIST', 'BANNER'].includes(String(section.sectionType)) &&
    typeof section.title === 'string' &&
    typeof section.displayOrder === 'number' &&
    Boolean(section.config && typeof section.config === 'object')
  );
}
