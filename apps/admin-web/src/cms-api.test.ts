import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmsApiError, getCmsHome } from './cms-api';

describe('Admin M4 CMS API adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps HTTP authorization/conflict statuses without treating UI as a security boundary', async () => {
    for (const status of [401, 403, 409]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      await expect(getCmsHome('token')).rejects.toMatchObject<CmsApiError>({ status });
    }
  });
});
