import { describe, expect, it } from 'vitest';
import {
  staffAdminAccountSchema,
  staffAdminCreateAccountSchema,
  staffAdminListQuerySchema,
  staffAdminReplaceDataScopesSchema,
  staffAdminReplaceRolesSchema,
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

  it('validates Staff creation and bounded RBAC replacement payloads', () => {
    expect(
      staffAdminCreateAccountSchema.parse({
        loginIdentifier: ' ops@example.com ',
        password: 'a-secure-passphrase',
      }),
    ).toMatchObject({ loginIdentifier: 'ops@example.com', enabled: true });
    expect(
      staffAdminCreateAccountSchema.safeParse({
        loginIdentifier: 'ops@example.com',
        password: 'short',
      }).success,
    ).toBe(false);

    const roleId = '33333333-3333-4333-8333-333333333333';
    expect(staffAdminReplaceRolesSchema.parse({ roleIds: [roleId] })).toEqual({ roleIds: [roleId] });
    expect(staffAdminReplaceRolesSchema.safeParse({ roleIds: [roleId, roleId] }).success).toBe(false);
  });

  it('enforces valid and non-ambiguous Data Scope replacement', () => {
    const storeId = '44444444-4444-4444-8444-444444444444';
    expect(
      staffAdminReplaceDataScopesSchema.parse({
        dataScopes: [{ type: 'STORE', id: storeId }],
      }),
    ).toEqual({ dataScopes: [{ type: 'STORE', id: storeId }] });

    expect(
      staffAdminReplaceDataScopesSchema.safeParse({
        dataScopes: [{ type: 'STORE', id: null }],
      }).success,
    ).toBe(false);
    expect(
      staffAdminReplaceDataScopesSchema.safeParse({
        dataScopes: [
          { type: 'GLOBAL', id: null },
          { type: 'STORE', id: storeId },
        ],
      }).success,
    ).toBe(false);
  });
});
