import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAdminProducts } from './catalog-api';
import type { CatalogApiError } from './catalog-api';

describe('M5 Admin catalog adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves unauthorized and forbidden errors', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      await expect(listAdminProducts('token')).rejects.toMatchObject<Partial<CatalogApiError>>({
        status,
      });
    }
  });
});
