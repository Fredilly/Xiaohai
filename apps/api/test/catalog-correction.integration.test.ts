import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  storeCatalogResponseSchema,
  catalogCorrectionRecordSchema,
} from '@xiaohai/contracts/commerce';
import {
  auditLogs,
  bookEditions,
  books,
  catalogCorrectionRequests,
  createDatabase,
  inventoryTransactions,
  permissions,
  products,
  regions,
  rolePermissions,
  roles,
  skus,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { StoreNetworkService } from '../src/stores/store-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';
import { registerStoreCatalogReadRoutes } from '../src/commerce/store-catalog-read-routes.js';
import { CatalogCorrectionService } from '../src/commerce/catalog-correction-service.js';
import { registerCatalogCorrectionRoutes } from '../src/commerce/catalog-correction-routes.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('daily catalog corrections against disposable PostgreSQL', () => {
  const db = database!.db;
  const sessions = new StaffSessionService(
    'catalog-correction-isolated-test-secret-long-enough-1234',
    300,
  );
  const auth = new StaffAuthorizationService(new DrizzleStaffAuthorizationRepository(db), sessions);
  const network = new StoreNetworkService(db);
  const corrections = new CatalogCorrectionService(db);
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await database!.pool.end();
  });

  async function fixture() {
    const [region] = await db
      .insert(regions)
      .values({
        code: 'CC-R-' + suffix,
        name: 'Correction Test Region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning();

    const [storeA, storeB] = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((name) => ({
          code: 'CC-S-' + name + '-' + suffix,
          name: 'Correction Test Store ' + name,
          regionId: region!.id,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: name,
          latitude: 30,
          longitude: 104,
        })),
      )
      .returning();

    const [bookA, bookB] = await db
      .insert(books)
      .values([
        { title: 'Original Book A', author: 'Author A' },
        { title: 'Original Book B', author: 'Author B' },
      ])
      .returning();
    const [editionA, editionB] = await db
      .insert(bookEditions)
      .values([
        { bookId: bookA!.id, isbn: '9780000000001', publisher: 'Publisher A' },
        { bookId: bookB!.id, isbn: '9780000000002', publisher: 'Publisher B' },
      ])
      .returning();
    const [productA, productB] = await db
      .insert(products)
      .values([
        { bookEditionId: editionA!.id, name: 'Test Product A' },
        { bookEditionId: editionB!.id, name: 'Test Product B' },
      ])
      .returning();
    const [skuA, skuB] = await db
      .insert(skus)
      .values([
        { productId: productA!.id, code: 'CC-A-' + suffix, name: 'A', priceMinor: 1500 },
        { productId: productB!.id, code: 'CC-B-' + suffix, name: 'B', priceMinor: 2000 },
      ])
      .returning();
    await db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: skuA!.id, onHand: 5, version: 2 },
      { storeId: storeB!.id, skuId: skuB!.id, onHand: 1, version: 1 },
    ]);

    async function createStaff(keys: string[], storeId: string) {
      const [actor] = await db
        .insert(staffAccounts)
        .values({
          loginIdentifier: 'cc-' + randomUUID() + '@example.com',
          passwordHash: 'test-only',
        })
        .returning();
      const [role] = await db
        .insert(roles)
        .values({
          key: 'cc-' + randomUUID(),
          displayName: 'Catalog Correction Test',
        })
        .returning();
      for (const key of keys) {
        await db.insert(permissions).values({ key, displayName: key }).onConflictDoNothing();
        const [permission] = await db
          .select({ id: permissions.id })
          .from(permissions)
          .where(eq(permissions.key, key))
          .limit(1);
        await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id });
      }
      await db.insert(staffRoles).values({ staffAccountId: actor!.id, roleId: role!.id });
      await db.insert(staffDataScopes).values({
        staffAccountId: actor!.id,
        scopeType: 'STORE',
        scopeId: storeId,
      });
      return { id: actor!.id, roleId: role!.id, token: sessions.issue(actor!.id).token };
    }

    const proposer = await createStaff(
      ['stores.read', 'inventory.read', 'inventory.stocktake', 'catalog.correction.review'],
      storeA!.id,
    );
    const reviewer = await createStaff(['stores.read', 'catalog.correction.review'], storeA!.id);
    const foreignReviewer = await createStaff(
      ['stores.read', 'catalog.correction.review'],
      storeB!.id,
    );

    const cleanup = async () => {
      const staffIds = [proposer.id, reviewer.id, foreignReviewer.id];
      const roleIds = [proposer.roleId, reviewer.roleId, foreignReviewer.roleId];
      await db
        .delete(catalogCorrectionRequests)
        .where(inArray(catalogCorrectionRequests.storeId, [storeA!.id, storeB!.id]));
      await db.delete(auditLogs).where(inArray(auditLogs.actorStaffAccountId, staffIds));
      await db.delete(staffDataScopes).where(inArray(staffDataScopes.staffAccountId, staffIds));
      await db.delete(staffRoles).where(inArray(staffRoles.staffAccountId, staffIds));
      await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
      await db.delete(roles).where(inArray(roles.id, roleIds));
      await db.delete(staffAccounts).where(inArray(staffAccounts.id, staffIds));
      await db
        .delete(storeInventory)
        .where(inArray(storeInventory.storeId, [storeA!.id, storeB!.id]));
      await db.delete(skus).where(inArray(skus.id, [skuA!.id, skuB!.id]));
      await db.delete(products).where(inArray(products.id, [productA!.id, productB!.id]));
      await db.delete(bookEditions).where(inArray(bookEditions.id, [editionA!.id, editionB!.id]));
      await db.delete(books).where(inArray(books.id, [bookA!.id, bookB!.id]));
      await db.delete(stores).where(inArray(stores.id, [storeA!.id, storeB!.id]));
      await db.delete(regions).where(eq(regions.id, region!.id));
    };
    return {
      storeA: storeA!,
      storeB: storeB!,
      skuA: skuA!,
      skuB: skuB!,
      bookA: bookA!,
      proposer,
      reviewer,
      foreignReviewer,
      cleanup,
    };
  }

  it('enforces real store isolation, independent review, concurrency and no master writes', async () => {
    const f = await fixture();
    const app = buildApp({ logger: false });
    registerStoreCatalogReadRoutes(app, {
      staffAuthorization: auth,
      stores: network,
      catalog: new StoreCatalogReadService(db),
    });
    registerCatalogCorrectionRoutes(app, {
      staffAuthorization: auth,
      stores: network,
      corrections,
    });
    const base = '/api/v1/staff/stores/';
    const bearer = (token: string) => ({ authorization: 'Bearer ' + token });

    try {
      const ownCatalog = await app.inject({
        method: 'GET',
        url: base + f.storeA.id + '/catalog',
        headers: bearer(f.proposer.token),
      });
      expect(ownCatalog.statusCode).toBe(200);
      const catalogResponse = storeCatalogResponseSchema.parse(ownCatalog.json());
      expect(catalogResponse.items).toHaveLength(1);
      expect(catalogResponse.items[0]?.skuId).toBe(f.skuA.id);
      const otherCatalog = await app.inject({
        method: 'GET',
        url: base + f.storeB.id + '/catalog',
        headers: bearer(f.proposer.token),
      });
      expect(otherCatalog.statusCode).toBe(403);

      const path = base + f.storeA.id + '/catalog-corrections';
      const proposed = await app.inject({
        method: 'POST',
        url: path,
        headers: bearer(f.proposer.token),
        payload: {
          skuId: f.skuA.id,
          expectedInventoryVersion: 2,
          field: 'bookTitle',
          proposedValue: 'Corrected A',
          reason: 'Compared with physical cover',
        },
      });
      expect(proposed.statusCode).toBe(201);
      const proposedBody = catalogCorrectionRecordSchema.parse(proposed.json());
      const requestId = proposedBody.id;
      expect(proposedBody.status).toBe('PENDING');

      const duplicate = await app.inject({
        method: 'POST',
        url: path,
        headers: bearer(f.proposer.token),
        payload: {
          skuId: f.skuA.id,
          expectedInventoryVersion: 2,
          field: 'bookTitle',
          proposedValue: 'Corrected A',
          reason: 'Same request',
        },
      });
      expect(duplicate.statusCode).toBe(409);

      const reviewerPath = path + '/' + requestId + '/review';
      const selfReview = await app.inject({
        method: 'POST',
        url: reviewerPath,
        headers: bearer(f.proposer.token),
        payload: { verdict: 'ACCEPTED', reason: 'Self approval' },
      });
      expect(selfReview.statusCode).toBe(403);
      const wrongStore = await app.inject({
        method: 'POST',
        url: reviewerPath,
        headers: bearer(f.foreignReviewer.token),
        payload: { verdict: 'ACCEPTED', reason: 'Other store' },
      });
      expect(wrongStore.statusCode).toBe(403);
      const accepted = await app.inject({
        method: 'POST',
        url: reviewerPath,
        headers: bearer(f.reviewer.token),
        payload: { verdict: 'ACCEPTED', reason: 'Independently checked' },
      });
      expect(accepted.statusCode).toBe(200);
      expect(catalogCorrectionRecordSchema.parse(accepted.json()).status).toBe('ACCEPTED');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: reviewerPath,
            headers: bearer(f.reviewer.token),
            payload: { verdict: 'ACCEPTED', reason: 'Repeat' },
          })
        ).statusCode,
      ).toBe(409);

      const [liveBook] = await db
        .select({ title: books.title })
        .from(books)
        .where(eq(books.id, f.bookA.id));
      expect(liveBook!.title).toBe('Original Book A');
      const [stock] = await db
        .select()
        .from(storeInventory)
        .where(and(eq(storeInventory.storeId, f.storeA.id), eq(storeInventory.skuId, f.skuA.id)));
      expect(stock!.onHand).toBe(5);
      expect(stock!.version).toBe(2);
      expect(
        await db
          .select()
          .from(inventoryTransactions)
          .where(eq(inventoryTransactions.storeId, f.storeA.id)),
      ).toHaveLength(0);
      const audit = await db
        .select()
        .from(auditLogs)
        .where(inArray(auditLogs.actorStaffAccountId, [f.proposer.id, f.reviewer.id]));
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit.map((row) => row.metadata))).not.toContain('Corrected A');
      expect(JSON.stringify(audit.map((row) => row.metadata))).not.toContain(
        'Independently checked',
      );
    } finally {
      await app.close();
      await f.cleanup();
    }
  });
});
