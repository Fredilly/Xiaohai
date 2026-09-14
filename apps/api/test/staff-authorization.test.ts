import { describe, expect, it } from 'vitest';
import { ConsumerSessionService } from '../src/auth/session.js';
import {
  StaffAuthorizationService,
  type StaffAuthorizationContext,
  type StaffAuthorizationRepository,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';

const staffId = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';
const otherStoreId = '33333333-3333-4333-8333-333333333333';
const now = () => new Date('2026-09-14T10:00:00.000Z');

class FakeRepository implements StaffAuthorizationRepository {
  constructor(public context: StaffAuthorizationContext | null) {}

  async loadContext(staffAccountId: string): Promise<StaffAuthorizationContext | null> {
    if (this.context?.staffAccountId !== staffAccountId) return null;
    return this.context;
  }
}

function createService(context: StaffAuthorizationContext | null, sessionNow = now) {
  const sessions = new StaffSessionService(
    'staff-authorization-test-secret-at-least-32-characters',
    300,
    sessionNow,
  );
  return {
    sessions,
    service: new StaffAuthorizationService(new FakeRepository(context), sessions),
  };
}

describe('StaffAuthorizationService', () => {
  const context: StaffAuthorizationContext = {
    staffAccountId: staffId,
    loginIdentifier: 'staff@example.com',
    permissions: ['staff.profile.read', 'inventory.read'],
    dataScopes: [{ type: 'STORE', id: storeId }],
  };

  it('authenticates a valid Staff token and resolves trusted staffAccountId', async () => {
    const { sessions, service } = createService(context);
    const token = sessions.issue(staffId).token;
    await expect(service.authenticate(`Bearer ${token}`)).resolves.toEqual(context);
  });

  it('returns 401 for missing or invalid Staff authentication', async () => {
    const { service } = createService(context);
    for (const header of [undefined, 'Bearer invalid.token']) {
      await expect(service.authenticate(header)).rejects.toMatchObject({
        code: 'STAFF_AUTHENTICATION_REQUIRED',
        statusCode: 401,
      });
    }
  });

  it('returns 401 for expired Staff tokens', async () => {
    const issuedAt = () => new Date('2026-09-14T10:00:00.000Z');
    const sessions = new StaffSessionService(
      'staff-authorization-test-secret-at-least-32-characters',
      60,
      issuedAt,
    );
    const token = sessions.issue(staffId).token;
    const verifier = new StaffSessionService(
      'staff-authorization-test-secret-at-least-32-characters',
      60,
      () => new Date('2026-09-14T10:02:00.000Z'),
    );
    const service = new StaffAuthorizationService(new FakeRepository(context), verifier);
    await expect(service.authenticate(`Bearer ${token}`)).rejects.toMatchObject({
      code: 'STAFF_AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  });

  it('rejects Consumer tokens as Staff authentication', async () => {
    const consumerSessions = new ConsumerSessionService(
      'consumer-authorization-test-secret-at-least-32-characters',
      300,
      now,
    );
    const consumerToken = consumerSessions.issue('44444444-4444-4444-8444-444444444444').token;
    const { service } = createService(context);
    await expect(service.authenticate(`Bearer ${consumerToken}`)).rejects.toMatchObject({
      code: 'STAFF_AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  });

  it('treats a disabled or missing Staff account as unauthenticated', async () => {
    const { sessions, service } = createService(null);
    const token = sessions.issue(staffId).token;
    await expect(service.authenticate(`Bearer ${token}`)).rejects.toMatchObject({
      code: 'STAFF_AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  });

  it('requires server-resolved permissions and defaults to deny', () => {
    const { service } = createService(context);
    expect(service.hasPermission(context, 'inventory.read')).toBe(true);
    expect(service.hasPermission(context, 'inventory.write')).toBe(false);
    expect(() => service.requirePermission(context, 'inventory.write')).toThrowError();
  });

  it('allows GLOBAL and exact STORE scopes but denies unrelated or unprovable scopes', () => {
    const { service } = createService(context);
    expect(service.canAccessScope(context, 'STORE', storeId)).toBe(true);
    expect(service.canAccessScope(context, 'STORE', otherStoreId)).toBe(false);
    expect(service.canAccessScope(context, 'REGION', storeId)).toBe(false);
    expect(service.canAccessScope({ ...context, dataScopes: [] }, 'STORE', storeId)).toBe(false);
    expect(
      service.canAccessScope(
        { ...context, dataScopes: [{ type: 'GLOBAL', id: null }] },
        'STORE',
        otherStoreId,
      ),
    ).toBe(true);
  });
});
