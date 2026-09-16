import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSeries, getAdminContent, ContentApiError } from './content-api';

describe('M7 Admin content adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves Staff authentication and authorization failures', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));

      await expect(getAdminContent('token')).rejects.toEqual(new ContentApiError(status));
    }
  });

  it('validates and sends series writes to the Staff content API', async () => {
    const input = {
      slug: 'little-sea',
      title: '小海童话',
      description: '测试系列',
      category: 'fairy-tale',
      coverUrl: null,
      status: 'DRAFT' as const,
    };

    const response = {
      id: '11111111-1111-4111-8111-111111111111',
      ...input,
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => response,
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(createAdminSeries('token', input)).resolves.toMatchObject({
      id: response.id,
      title: input.title,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/staff/content/series'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  });
});
