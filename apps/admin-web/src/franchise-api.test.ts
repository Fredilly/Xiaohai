import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignFranchiseApplication, listFranchiseApplications } from './franchise-api';

const baseApplication = {
  id: '11111111-1111-4111-8111-111111111111',
  applicationNumber: 'FA-TEST',
  submittedByConsumerUserId: null,
  name: '测试申请人',
  phone: '13800000000',
  email: null,
  country: '中国',
  region: '四川省',
  city: '成都',
  district: null,
  background: null,
  message: null,
  status: 'SUBMITTED',
  assignedStaffAccountId: null,
  reviewedByStaffAccountId: null,
  reviewNote: null,
  submittedAt: '2026-09-18T00:00:00.000Z',
  assignedAt: null,
  reviewedAt: null,
  approvedAt: null,
  rejectedAt: null,
  signedAt: null,
  preparingAt: null,
  openedAt: null,
  closedAt: null,
  version: 1,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('M17 Admin franchise adapter', () => {
  it('sends authenticated list filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [baseApplication] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listFranchiseApplications('staff-token', {
      status: 'SUBMITTED',
      query: '测试',
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/franchise/applications?');
    expect(url).toContain('status=SUBMITTED');
    expect(url).toContain('query=');
    expect(url).toContain('limit=20');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer staff-token' });
  });

  it('sends only assignee and optimistic-lock version when assigning', async () => {
    const assignee = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...baseApplication,
        status: 'ASSIGNED',
        assignedStaffAccountId: assignee,
        assignedAt: '2026-09-18T01:00:00.000Z',
        version: 2,
        followups: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await assignFranchiseApplication('staff-token', baseApplication.id, {
      staffAccountId: assignee,
      version: 1,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    if (typeof init.body !== 'string') throw new Error('Expected JSON request body');
    expect(JSON.parse(init.body)).toEqual({ staffAccountId: assignee, version: 1 });
  });
});
