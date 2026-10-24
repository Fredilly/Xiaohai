import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  auditLogs,
  createDatabase,
  meipingImportBatches,
  meipingImportResults,
  meipingReviewDecisions,
  meipingReviewSessions,
  permissions,
  regions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  stores,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { ScryptPasswordHasher } from '../src/auth/password.js';
import { StaffAuthService } from '../src/auth/staff-auth-service.js';
import { DrizzleStaffAccountRepository } from '../src/auth/staff-repository.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerMeipingApplyRoutes } from '../src/migration/meiping-apply-routes.js';
import { MeipingApplyService } from '../src/migration/meiping-apply-service.js';
import { StoreNetworkService } from '../src/stores/store-service.js';
import type { MeipingPreflightReport } from '../src/migration/meiping-preflight.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const sessionSecret = 'meiping-http-integration-secret-at-least-32-bytes';

suite('Meiping guarded apply HTTP Staff Auth and scope integration', () => {
  const created = {
    region: '',
    stores: [] as string[],
    staff: [] as string[],
    role: '',
    permissionIds: [] as string[],
    session: '',
    batch: '',
  };

  afterAll(async () => {
    if (!database) return;
    if (created.batch) {
      await database.db
        .delete(meipingImportResults)
        .where(eq(meipingImportResults.batchId, created.batch));
      await database.db
        .delete(meipingImportBatches)
        .where(eq(meipingImportBatches.id, created.batch));
    }
    if (created.session) {
      await database.db
        .delete(meipingReviewDecisions)
        .where(eq(meipingReviewDecisions.sessionId, created.session));
      await database.db
        .delete(meipingReviewSessions)
        .where(eq(meipingReviewSessions.id, created.session));
    }
    if (created.staff.length) {
      await database.db
        .delete(auditLogs)
        .where(inArray(auditLogs.actorStaffAccountId, created.staff));
      await database.db
        .delete(staffDataScopes)
        .where(inArray(staffDataScopes.staffAccountId, created.staff));
      await database.db.delete(staffRoles).where(inArray(staffRoles.staffAccountId, created.staff));
      await database.db.delete(staffAccounts).where(inArray(staffAccounts.id, created.staff));
    }
    if (created.role)
      await database.db.delete(rolePermissions).where(eq(rolePermissions.roleId, created.role));
    if (created.permissionIds.length)
      await database.db.delete(permissions).where(inArray(permissions.id, created.permissionIds));
    if (created.role) await database.db.delete(roles).where(eq(roles.id, created.role));
    if (created.stores.length)
      await database.db.delete(stores).where(inArray(stores.id, created.stores));
    if (created.region) await database.db.delete(regions).where(eq(regions.id, created.region));
    await database.pool.end();
  });

  it('authenticates real Staff sessions and rejects cross-store read/approve/execute', async () => {
    const suffix = randomUUID().slice(0, 8);
    const password = `local-only-${randomUUID()}`;
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `HTTP-R-${suffix}`,
        name: 'HTTP security region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    created.region = region!.id;
    const createdStores = await database!.db
      .insert(stores)
      .values([
        {
          regionId: region!.id,
          code: `HTTP-A-${suffix}`,
          name: 'HTTP security store A',
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable HTTP test',
          latitude: 30.5,
          longitude: 104,
        },
        {
          regionId: region!.id,
          code: `HTTP-B-${suffix}`,
          name: 'HTTP security store B',
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable HTTP test',
          latitude: 30.51,
          longitude: 104.01,
        },
      ])
      .returning({ id: stores.id });
    const firstStore = createdStores[0];
    const secondStore = createdStores[1];
    if (!firstStore?.id || !secondStore?.id) throw new Error('HTTP test stores were not created');
    created.stores = createdStores.map((store) => store.id);
    const storeAId: string = firstStore.id;
    const storeBId: string = secondStore.id;
    const permissionKeys = [
      'meiping.import.preview',
      'meiping.import.approve',
      'meiping.import.execute',
    ];
    const permissionRows = [] as Array<{ id: string }>;
    for (const key of permissionKeys) {
      const [existing] = await database!.db
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, key));
      const [permission] = existing
        ? [existing]
        : await database!.db
            .insert(permissions)
            .values({ key, displayName: key, description: 'Disposable HTTP test permission' })
            .returning({ id: permissions.id });
      permissionRows.push(permission!);
      if (!existing) created.permissionIds.push(permission!.id);
    }
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `HTTP-ROLE-${suffix}`, displayName: 'HTTP test role' })
      .returning({ id: roles.id });
    created.role = role!.id;
    await database!.db
      .insert(rolePermissions)
      .values(
        permissionRows.map((permission) => ({ roleId: role!.id, permissionId: permission.id })),
      );
    const passwordHash = await new ScryptPasswordHasher().hash(password);
    const accounts = await database!.db
      .insert(staffAccounts)
      .values([
        { loginIdentifier: `http-a-${suffix}`, passwordHash },
        { loginIdentifier: `http-b-${suffix}`, passwordHash },
        { loginIdentifier: `http-reviewer-${suffix}`, passwordHash },
      ])
      .returning({ id: staffAccounts.id, loginIdentifier: staffAccounts.loginIdentifier });
    if (!accounts[0]?.id || !accounts[1]?.id || !accounts[2]?.id)
      throw new Error('HTTP test staff accounts were not created');
    const actorId: string = accounts[0].id;
    const storeStaffId: string = accounts[1].id;
    const reviewerId: string = accounts[2].id;
    created.staff = accounts.map((account) => account.id);
    await database!.db
      .insert(staffRoles)
      .values(accounts.map((account) => ({ staffAccountId: account.id, roleId: role!.id })));
    await database!.db.insert(staffDataScopes).values([
      { staffAccountId: actorId, scopeType: 'STORE', scopeId: storeAId },
      { staffAccountId: storeStaffId, scopeType: 'STORE', scopeId: storeBId },
      { staffAccountId: reviewerId, scopeType: 'STORE', scopeId: storeAId },
    ]);
    const report: MeipingPreflightReport = {
      sourceType: 'MEIPING_XLS',
      sourceChecksum: '9'.repeat(64),
      sourceStoreId: storeAId,
      sourceStoreCode: `HTTP-A-${suffix}`,
      inventoryApproval: 'PENDING_ADMIN_REVIEW',
      totalRows: 1,
      matchedRows: 0,
      createCandidateRows: 1,
      exceptionRows: 0,
      metadataWarningRows: 0,
      blockingRows: 0,
      saleBlockedRows: 0,
      assumedInventoryRows: 1,
      plannedInventoryTotal: 1,
      exceptionReportCsv: '',
      rows: [
        {
          sourceRowNumber: 2,
          rawColumns: { title: 'HTTP-only book' },
          sourceCategory: '图书',
          sourceCategoryType: 'BOOK',
          sourceIdentifiers: {
            bookCode: null,
            internalCode: null,
            barcode: 'STORE-BARCODE-ONLY',
            isbn: '9780306406157',
          },
          normalized: {
            title: 'HTTP-only book',
            author: 'HTTP author',
            publisher: null,
            priceMinor: 1000,
          },
          plannedInventory: 1,
          inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE',
          matchStatus: 'UNMATCHED_REVIEW',
          disposition: 'CREATE_CANDIDATE',
          issues: [],
          metadataWarnings: [],
          blockingIssues: [],
          saleBlocked: [],
        },
      ],
    };
    const [session] = await database!.db
      .insert(meipingReviewSessions)
      .values({
        storeId: storeAId,
        sourceChecksum: '9'.repeat(64),
        status: 'DRAFT',
        report: report as Record<string, unknown>,
        createdByStaffAccountId: actorId,
      })
      .returning({ id: meipingReviewSessions.id });
    created.session = session!.id;
    await database!.db.insert(meipingReviewDecisions).values({
      sessionId: session!.id,
      sourceRowNumber: 2,
      action: 'CREATE_DRAFT',
      countedQuantity: 0,
      updatedByStaffAccountId: actorId,
    });

    const sessions = new StaffSessionService(sessionSecret, 300);
    const authorization = new StaffAuthorizationService(
      new DrizzleStaffAuthorizationRepository(database!.db),
      sessions,
    );
    const app = buildApp({
      logger: false,
      staffAuth: new StaffAuthService(
        new DrizzleStaffAccountRepository(database!.db),
        new ScryptPasswordHasher(),
        sessions,
      ),
      staffAuthorization: authorization,
    });
    registerMeipingApplyRoutes(app, {
      apply: new MeipingApplyService(database!.db, false),
      staffAuthorization: authorization,
      stores: new StoreNetworkService(database!.db),
    });
    const login = async (loginIdentifier: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/staff/auth/login',
        payload: { loginIdentifier, password },
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ session: { token: string } }>().session.token;
    };
    const tokenA = await login(accounts[0].loginIdentifier);
    const tokenB = await login(accounts[1].loginIdentifier);
    const tokenReviewer = await login(accounts[2].loginIdentifier);
    const queryA = `?storeId=${storeAId}`;
    const queryB = `?storeId=${storeBId}`;
    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/migrations/meiping/review-sessions/${session!.id}/import-preview${queryA}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(preview.statusCode).toBe(200);
    const batchId = preview.json<{ batchId: string }>().batchId;
    created.batch = batchId;
    for (const request of [
      {
        method: 'GET' as const,
        url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}${queryA}`,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}/approve${queryA}`,
      },
    ]) {
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(response.statusCode).toBe(request.method === 'GET' ? 200 : 409);
    }
    const crossStoreRequests = [
      {
        method: 'GET' as const,
        url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}${queryB}`,
        token: tokenB,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}/approve${queryB}`,
        token: tokenB,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}/execute${queryB}`,
        token: tokenB,
      },
    ];
    for (const request of crossStoreRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${request.token}` },
      });
      expect(response.statusCode).toBe(403);
    }
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}/approve${queryA}`,
      headers: { authorization: `Bearer ${tokenReviewer}` },
    });
    expect(approved.statusCode).toBe(200);
    const disabledExecute = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/migrations/meiping/import-batches/${batchId}/execute${queryA}`,
      headers: { authorization: `Bearer ${tokenReviewer}` },
    });
    expect(disabledExecute.statusCode).toBe(409);
    await app.close();
  });
});
