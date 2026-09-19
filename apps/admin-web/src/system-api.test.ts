import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuditLogs, loadSystemHealth } from './system-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('system-api', () => {
  it('loads API health without Staff authorization', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok', service: 'xiaohai-api' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(loadSystemHealth()).resolves.toEqual({ status: 'ok', service: 'xiaohai-api' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/health');
  });

  it('sends Staff bearer token and bounded audit filters', async () => {
    const actor = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              actorStaffAccountId: actor,
              actionKey: 'staff.account.enabled',
              resourceType: 'staff_account',
              resourceId: '33333333-3333-4333-8333-333333333333',
              requestId: 'req-1',
              metadata: { enabled: false },
              createdAt: '2026-09-19T08:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await loadAuditLogs('staff-token', {
      actorStaffAccountId: actor,
      actionKey: 'staff.account.enabled',
      resourceType: 'staff_account',
      resourceId: '33333333-3333-4333-8333-333333333333',
      requestId: 'req-1',
      limit: 25,
    });

    expect(result.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('actionKey=staff.account.enabled');
    expect(String(url)).toContain('limit=25');
    expect(init?.headers).toEqual({ Authorization: 'Bearer staff-token' });
  });
});
