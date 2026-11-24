import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadStoreMeipingExceptions,
  previewStoreMeiping,
  validateMeipingFile,
} from './store-meiping-preflight-api';

afterEach(() => vi.unstubAllGlobals());
const storeId = '11111111-1111-4111-8111-111111111111';
const file = new File(['synthetic fixture'], 'test.xls', { type: 'application/vnd.ms-excel' });

const validReport = {
  sourceType: 'MEIPING_XLS',
  sourceStoreId: storeId,
  sourceChecksum: 'a'.repeat(64),
  inventoryApproval: 'PENDING_ADMIN_REVIEW',
  totalRows: 10,
  matchedRows: 2,
  createCandidateRows: 7,
  exceptionRows: 1,
  metadataWarningRows: 4,
  blockingRows: 1,
  saleBlockedRows: 0,
  assumedInventoryRows: 10,
};

describe('Store Web Meiping workbook preflight', () => {
  it('accepts only nonempty bounded XLS/XLSX files', () => {
    expect(validateMeipingFile(file)).toBeNull();
    expect(validateMeipingFile(new File(['x'], 'test.xlsx'))).toBeNull();
    expect(validateMeipingFile(new File(['x'], 'test.csv'))).not.toBeNull();
    expect(validateMeipingFile({ name: 'test.xlsx', size: 5 * 1024 * 1024 + 1 })).not.toBeNull();
    expect(validateMeipingFile({ name: 'test.xls', size: 0 })).not.toBeNull();
  });

  it('runs the existing scoped read-only preflight with staff credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(validReport) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await previewStoreMeiping('staff-session', storeId, file)).toMatchObject({
      totalRows: 10,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/staff/migrations/meiping/preflight?storeId=${storeId}&format=json`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({
      authorization: 'Bearer staff-session',
      'content-type': 'application/vnd.ms-excel',
    });
  });

  it('rejects mismatched store, fake approval and impossible totals', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const response of [
      { ...validReport, sourceStoreId: '22222222-2222-4222-8222-222222222222' },
      { ...validReport, inventoryApproval: 'APPROVED' },
      { ...validReport, sourceChecksum: 'bad' },
      { ...validReport, blockingRows: 11 },
    ]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(response) });
      await expect(previewStoreMeiping('t', storeId, file)).rejects.toThrow(
        'INVALID_PREFLIGHT_RESPONSE',
      );
    }
  });

  it('downloads only the exception CSV via the same read-only scoped endpoint', async () => {
    const csv = new Blob(['sourceRowNumber,code\n2,MISSING_TITLE'], { type: 'text/csv' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(csv) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await downloadStoreMeipingExceptions('staff', storeId, file)).toBe(csv);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(`storeId=${storeId}&format=csv`);
  });
});
