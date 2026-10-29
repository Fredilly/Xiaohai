import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMeipingExceptions, preflightMeipingFile } from './meiping-preflight-api';

afterEach(() => vi.unstubAllGlobals());

const storeId = '11111111-1111-4111-8111-111111111111';

describe('Meiping preflight admin adapter', () => {
  it('uploads the raw workbook to the selected store without inventory writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        sourceType: 'MEIPING_XLS',
        totalRows: 0,
        rows: [],
        exceptionReportCsv: '',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = new Blob(['test'], { type: 'application/vnd.ms-excel' });

    await preflightMeipingFile('staff-token', storeId, file);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`storeId=${storeId}`);
    expect(url).toContain('format=json');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer staff-token',
      'content-type': 'application/vnd.ms-excel',
    });
    expect(init.body).toBe(file);
  });

  it('downloads only the server-generated exception CSV', async () => {
    const blob = new Blob(['source_row_number,reason_codes\n']);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadMeipingExceptions('staff-token', storeId, new Blob(['test'])),
    ).resolves.toBe(blob);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('format=csv');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
  });

  it('preserves forbidden and oversized upload errors', async () => {
    for (const status of [403, 413]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: vi.fn().mockResolvedValue({ error: { code: 'TEST_ERROR' } }),
        }),
      );
      await expect(
        preflightMeipingFile('staff-token', storeId, new Blob(['test'])),
      ).rejects.toMatchObject({ status });
    }
  });
});
