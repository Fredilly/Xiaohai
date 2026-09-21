import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFinanceReconciliation,
  exportFinanceLedger,
  loadFinanceLedger,
  loadFinanceSummary,
} from './finance-api';

afterEach(() => vi.unstubAllGlobals());

const range = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-21T00:00:00.000Z',
};

const run = {
  id: '11111111-1111-4111-8111-111111111111',
  requestedByStaffAccountId: '22222222-2222-4222-8222-222222222222',
  rangeFrom: range.from,
  rangeTo: range.to,
  status: 'COMPLETED',
  matchedCount: 1,
  missingCount: 0,
  mismatchCount: 0,
  createdAt: '2026-09-21T00:00:00.000Z',
  completedAt: '2026-09-21T00:00:01.000Z',
};

describe('M21 Finance admin adapter', () => {
  it('loads summary and bounded ledger filters with Staff authorization', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          cashInflowMinor: 2500,
          cashOutflowMinor: 500,
          netCashMinor: 2000,
          commissionFrozenDeltaMinor: 100,
          commissionAvailableDeltaMinor: 200,
          currency: 'CNY',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    expect((await loadFinanceSummary('token', range)).netCashMinor).toBe(2000);
    expect(
      (
        await loadFinanceLedger('token', {
          ...range,
          sourceKind: 'PAYMENT_LEDGER',
          eventType: 'PAYMENT',
          limit: 25,
        })
      ).items,
    ).toEqual([]);

    const [summaryUrl, summaryInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(summaryUrl).toContain('/api/v1/staff/finance/summary?');
    expect(summaryUrl).toContain('from=');
    expect(new Headers(summaryInit.headers).get('Authorization')).toBe('Bearer token');

    const [ledgerUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(ledgerUrl).toContain('sourceKind=PAYMENT_LEDGER');
    expect(ledgerUrl).toContain('eventType=PAYMENT');
    expect(ledgerUrl).toContain('limit=25');
  });

  it('creates reconciliation and export through dedicated privileged endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(run) })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'content-disposition': 'attachment; filename="finance-ledger-test.csv"',
          'x-exported-row-count': '1',
        }),
        text: vi.fn().mockResolvedValue('event_key\nsource-event\n'),
      });
    vi.stubGlobal('fetch', fetchMock);

    expect((await createFinanceReconciliation('token', range)).status).toBe('COMPLETED');
    const exported = await exportFinanceLedger('token', { ...range, limit: 100 });
    expect(exported).toEqual({
      csv: 'event_key\nsource-event\n',
      filename: 'finance-ledger-test.csv',
      rowCount: 1,
    });

    const [reconcileUrl, reconcileInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(reconcileUrl).toContain('/api/v1/staff/finance/reconciliation-runs');
    expect(reconcileInit.method).toBe('POST');
    if (typeof reconcileInit.body !== 'string') throw new Error('Expected JSON request body');
    expect(JSON.parse(reconcileInit.body)).toEqual(range);

    const [exportUrl, exportInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(exportUrl).toContain('/api/v1/staff/finance/exports');
    expect(exportInit.method).toBe('POST');
    expect(new Headers(exportInit.headers).get('Authorization')).toBe('Bearer token');
  });
});
