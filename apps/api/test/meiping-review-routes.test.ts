import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ConsumerAuthError } from '../src/auth/errors.js';
import { registerMeipingReviewRoutes } from '../src/migration/meiping-review-routes.js';
import type { StaffAuthorizationContext } from '../src/auth/staff-authorization.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const otherStoreId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const checksum = 'a'.repeat(64);

function routeFixture(permissions: string[], allowedStore = storeId) {
  const context: StaffAuthorizationContext = {
    staffAccountId: '44444444-4444-4444-8444-444444444444',
    loginIdentifier: 'route-test',
    permissions,
    dataScopes: [{ type: 'STORE', id: allowedStore }],
  };
  const calls: string[] = [];
  const app = Fastify({ logger: false });
  registerMeipingReviewRoutes(app, {
    staffAuthorization: {
      authenticate: () => Promise.resolve(context),
      hasPermission: (value: StaffAuthorizationContext, permission: string) =>
        value.permissions.includes(permission),
      requirePermission: (value: StaffAuthorizationContext, permission: string) => {
        if (!value.permissions.includes(permission)) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
      },
    } as never,
    inventory: {
      requireStoreAccess: (value: StaffAuthorizationContext, targetStoreId: string) => {
        if (!value.dataScopes.some((scope) => scope.id === targetStoreId)) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
        return Promise.resolve({ id: targetStoreId });
      },
    } as never,
    stores: {
      getStaffStore: (targetStoreId: string) => {
        if (targetStoreId !== allowedStore) {
          throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
        }
        return Promise.resolve({ id: targetStoreId, code: 'PR153-TEST' });
      },
    } as never,
    review: {
      listSessions: () => {
        calls.push('listSessions');
        return Promise.resolve({ items: [], storeId, offset: 0, limit: 20, hasMore: false });
      },
      listRows: () => {
        calls.push('listRows');
        return Promise.resolve({ items: [], sessionId, storeId, status: 'DRAFT' });
      },
      saveCorrection: () => {
        calls.push('saveCorrection');
        return Promise.resolve({});
      },
      saveDecision: () => {
        calls.push('saveDecision');
        return Promise.resolve({});
      },
      reviewCorrection: () => {
        calls.push('reviewCorrection');
        return Promise.resolve({ correctionVersion: 1, verdict: 'REJECTED' });
      },
      createSession: () => {
        calls.push('createSession');
        return Promise.resolve({});
      },
    } as never,
    db: {} as never,
  });
  return { app, calls };
}

describe('Meiping review route permission boundaries', () => {
  it('lets an independent reviewer read only an authorized store', async () => {
    const { app, calls } = routeFixture(['meiping.correction.review']);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/migrations/meiping/review-sessions?storeId=${storeId}`,
      headers: { authorization: 'Bearer test' },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${sessionId}?storeId=${storeId}`,
      headers: { authorization: 'Bearer test' },
    });
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/migrations/meiping/review-sessions?storeId=${otherStoreId}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(403);
    expect(calls).toEqual(['listSessions', 'listRows']);
    await app.close();
  });

  it('does not give an independent reviewer create, edit, or correction-write access', async () => {
    const { app, calls } = routeFixture(['meiping.correction.review']);
    const decision = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${sessionId}/decisions/2?storeId=${storeId}`,
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      payload: {
        action: 'EXCLUDE',
        sourceRowNumber: 2,
        reason: '只读权限测试',
        expectedVersion: 0,
        expectedChecksum: checksum,
      },
    });
    const correction = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${sessionId}/corrections/2?storeId=${storeId}`,
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      payload: {
        expectedVersion: 0,
        expectedChecksum: checksum,
        proposedFields: { barcode: 'PR153-READONLY' },
        reason: '只读权限测试',
      },
    });
    const verdict = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${sessionId}/corrections/2/review?storeId=${storeId}`,
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      payload: {
        expectedCorrectionVersion: 1,
        expectedChecksum: checksum,
        verdict: 'REJECTED',
        reason: '独立复核测试',
      },
    });
    expect(decision.statusCode).toBe(403);
    expect(correction.statusCode).toBe(403);
    expect(verdict.statusCode).toBe(200);
    expect(calls).toEqual(['reviewCorrection']);
    await app.close();
  });

  it('preserves the original receive plus stocktake read and edit boundary', async () => {
    const { app, calls } = routeFixture(['inventory.receive', 'inventory.stocktake']);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/migrations/meiping/review-sessions?storeId=${storeId}`,
      headers: { authorization: 'Bearer test' },
    });
    const correction = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${sessionId}/corrections/2?storeId=${storeId}`,
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      payload: {
        expectedVersion: 0,
        expectedChecksum: checksum,
        proposedFields: { barcode: 'PR153-EDITOR' },
        reason: '编辑权限测试',
      },
    });
    const stocktakeOnly = routeFixture(['inventory.stocktake']);
    const restrictedList = await stocktakeOnly.app.inject({
      method: 'GET',
      url: `/api/v1/staff/migrations/meiping/review-sessions?storeId=${storeId}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(list.statusCode).toBe(200);
    expect(correction.statusCode).toBe(200);
    expect(restrictedList.statusCode).toBe(403);
    expect(calls).toEqual(['listSessions', 'saveCorrection']);
    await app.close();
    await stocktakeOnly.app.close();
  });
});
