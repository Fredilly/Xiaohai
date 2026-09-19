import { describe, expect, it } from 'vitest';
import { auditLogListQuerySchema, auditLogSchema } from './audit.js';

describe('M20 audit contracts', () => {
  it('parses bounded audit filters', () => {
    expect(
      auditLogListQuerySchema.parse({
        actionKey: 'staff.account.create',
        resourceType: 'STAFF_ACCOUNT',
        limit: '25',
      }),
    ).toMatchObject({
      actionKey: 'staff.account.create',
      resourceType: 'STAFF_ACCOUNT',
      limit: 25,
    });

    expect(
      auditLogListQuerySchema.safeParse({
        createdFrom: '2026-09-19T12:00:00.000Z',
        createdTo: '2026-09-19T11:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts redacted structured metadata', () => {
    expect(
      auditLogSchema.parse({
        id: '11111111-1111-4111-8111-111111111111',
        actorStaffAccountId: '22222222-2222-4222-8222-222222222222',
        actionKey: 'staff.account.set_enabled',
        resourceType: 'STAFF_ACCOUNT',
        resourceId: '33333333-3333-4333-8333-333333333333',
        requestId: 'req-m20-audit',
        metadata: { enabled: false },
        createdAt: '2026-09-19T12:00:00.000Z',
      }).metadata,
    ).toEqual({ enabled: false });
  });
});
