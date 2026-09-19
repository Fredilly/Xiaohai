import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchStoreBooks } from './book-search-api';

const storeId = '11111111-1111-4111-8111-111111111111';

afterEach(() => vi.unstubAllGlobals());

describe('M19 store book search adapter', () => {
  it('scopes public inventory search to the selected store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchStoreBooks(storeId, '小海');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/v1/inventory/books?');
    expect(url).toContain(`storeId=${storeId}`);
    expect(url).toContain('q=%E5%B0%8F%E6%B5%B7');
    expect(url).toContain('availability=ANY');
  });
});
