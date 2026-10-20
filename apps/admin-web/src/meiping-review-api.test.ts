import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMeipingReviewSession,
  getMeipingReviewPage,
  listMeipingReviewSessions,
  saveMeipingReviewDecision,
} from './meiping-review-api';

afterEach(() => vi.unstubAllGlobals());
const storeId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const checksum = 'a'.repeat(64);

describe('Meiping review admin HTTP adapter', () => {

  it('lists only authorized-store draft summaries without requiring Excel or leaking rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        storeId, offset: 0, limit: 20, hasMore: false,
        items: [{
          id: sessionId, storeId, status: 'DRAFT', sourceChecksum: checksum,
          totalRows: 6, savedDecisions: 3, createdAt: '2026-10-20T09:00:00.000Z',
          approved: false, catalogOrInventoryWritten: false,
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const summary = await listMeipingReviewSessions('staff-token', storeId);
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({ savedDecisions: 3, totalRows: 6 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/review-sessions?storeId=' + storeId);
    expect(url).toContain('offset=0');
    expect(url).toContain('limit=20');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ' + 'staff-token' });
    expect(JSON.stringify(summary)).not.toContain('rawColumns');
    expect(JSON.stringify(summary)).not.toContain('sourceIdentifiers');
  });

  it('fails closed on foreign-store, invalid status, or approved review summaries', async () => {
    const safe = {
      id: sessionId, storeId, status: 'DRAFT', sourceChecksum: checksum,
      totalRows: 6, savedDecisions: 1, createdAt: '2026-10-20T09:00:00.000Z',
      approved: false, catalogOrInventoryWritten: false,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const invalid of [
      { ...safe, storeId: 'foreign-store' },
      { ...safe, status: 'APPROVED' },
      { ...safe, approved: true },
      { ...safe, savedDecisions: 9 },
    ]) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          storeId, offset: 0, limit: 20, hasMore: false, items: [invalid],
        }),
      });
      await expect(listMeipingReviewSessions('token', storeId))
        .rejects.toThrow('INVALID_REVIEW_SESSION_LIST_RESPONSE');
    }
  });

  it('sends the original workbook to the server with Staff bearer auth', async () => {
    const file = new File(['test'], 'inventory.xls');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: sessionId,
        storeId,
        sourceChecksum: checksum,
        created: true,
        totalRows: 1000,
        status: 'DRAFT',
        approved: false,
        catalogOrInventoryWritten: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await createMeipingReviewSession('staff-token', storeId, file);
    expect(result.totalRows).toBe(1000);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('review-sessions?');
    expect(url).toContain('storeId=' + storeId);
    expect(options.method).toBe('POST');
    expect(options.body).toBe(file);
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer ' + 'staff-token',
      'content-type': 'application/vnd.ms-excel',
    });
  });

  it('pages only within the selected store/session and rejects mismatched API context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        sessionId,
        storeId,
        sourceChecksum: checksum,
        status: 'DRAFT',
        totalRows: 1000,
        offset: 25,
        limit: 25,
        items: [],
        approved: false,
        catalogOrInventoryWritten: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getMeipingReviewPage('staff-token', storeId, sessionId, 25, 25),
    ).resolves.toMatchObject({ offset: 25, items: [] });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(sessionId);
    expect(url).toContain('storeId=' + storeId);
    expect(url).toContain('offset=25');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer ' + 'staff-token' });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        sessionId,
        storeId: 'other-store',
        sourceChecksum: checksum,
        totalRows: 1000,
        offset: 25,
        items: [],
        approved: false,
        catalogOrInventoryWritten: false,
      }),
    });
    await expect(getMeipingReviewPage('staff-token', storeId, sessionId, 25)).rejects.toThrow(
      'REVIEW_PAGE_CONTEXT_MISMATCH',
    );
  });

  it('saves a version-bound decision without assuming inventory or approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        version: 2,
        approved: false,
        catalogOrInventoryWritten: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      saveMeipingReviewDecision('staff-token', storeId, sessionId, {
        action: 'CREATE_DRAFT',
        sourceRowNumber: 21,
        countedQuantity: 0,
        expectedVersion: 1,
        expectedChecksum: checksum,
      }),
    ).resolves.toEqual({ version: 2 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/decisions/21?');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ' + 'staff-token' });
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'CREATE_DRAFT',
      sourceRowNumber: 21,
      countedQuantity: 0,
      expectedVersion: 1,
      expectedChecksum: checksum,
    });
  });

  it('keeps backend conflict, permission and malformed response errors explicit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: { code: 'CONFLICT' } }),
      }),
    );
    await expect(getMeipingReviewPage('token', storeId, sessionId, 0)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ version: 1, approved: true, catalogOrInventoryWritten: true }),
      }),
    );
    await expect(
      saveMeipingReviewDecision('token', storeId, sessionId, {
        sourceRowNumber: 2,
        action: 'EXCLUDE',
        reason: '待核对',
        expectedVersion: 0,
        expectedChecksum: checksum,
      }),
    ).rejects.toThrow('INVALID_DECISION_RESPONSE');
  });
});
