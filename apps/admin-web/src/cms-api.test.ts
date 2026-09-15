import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CmsApiError } from './cms-api';
import { getCmsHome, updateCmsSection } from './cms-api';

describe('Admin M4 CMS API adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps HTTP authorization/conflict statuses without treating UI as a security boundary', async () => {
    for (const status of [401, 403, 409]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      await expect(getCmsHome('token')).rejects.toMatchObject<CmsApiError>({ status });
    }
  });

  it('sends the validated editable CMS fields with the optimistic-concurrency version', async () => {
    const input = {
      version: 7,
      sectionType: 'BANNER' as const,
      title: '运营 Banner',
      subtitle: '副标题',
      displayOrder: 2,
      enabled: false,
      publicationState: 'PUBLISHED' as const,
      config: { body: '正式内容' },
      mediaUrl: 'https://example.com/banner.jpg',
      action: { type: 'PREVIEW' as const, target: 'shop' },
    };
    const response = {
      id: '11111111-1111-4111-8111-111111111111',
      ...input,
      updatedAt: '2026-09-15T00:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => response });
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateCmsSection('token', response.id, input)).resolves.toMatchObject({
      title: input.title,
      version: input.version,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/staff/cms/home/sections/${response.id}`),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
  });
});
