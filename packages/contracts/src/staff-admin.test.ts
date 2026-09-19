import { describe, expect, it } from 'vitest';
import {
  staffAdminAccountSchema,
  staffAdminListQuerySchema,
  staffAdminRolesResponseSchema,
} from './staff-admin.js';

describe('M20 Staff admin contracts', () => {
  it('parses bounded Staff filters and rejects unknown query fields', () => {
    expect(staffAdminListQuerySchema.parse({ enabled: 'true', limit: '20' })).toEqual({
      enabled: true,
      limit: 20,
    });
    expect(staffAdminListQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(staffAdminListQuerySchema.safeParse({ serverControlled: true }).success).toBe(false);
  });

  it('keeps password material outside Staff and role responses', () => {
    const account = staffAdminAccountSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      loginIdentifier: 'hq@example.com',
      enabled: true,
      roles: [],
      dataScopes: [{ type: 'GLOBAL', id: null }],
      lastLoginAt: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z',
    });
    expect(account).not.toHaveProperty('passwordHash');

    expect(
      staffAdminRolesResponseSchema.parse({
        items: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            key: 'hq-reader',
            displayName: 'HQ Reader',
            description: null,
            permissions: [],
          },
        ],
      }).items,
    ).toHaveLength(1);
  });
});
