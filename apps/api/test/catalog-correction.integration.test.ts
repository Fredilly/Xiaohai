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

const databaseUrl = process.env.DATABASE_URL;
// Never run mutating fixtures against development, staging, or production.
const database =
  databaseUrl && /^xiaohai_(test|pr156_test)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
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
    const foreignProposer = await createStaff(
      ['stores.read', 'inventory.read', 'inventory.stocktake'],
      storeB!.id,
    );

    const cleanup = async () => {
      const staffIds = [proposer.id, reviewer.id, foreignReviewer.id, foreignProposer.id];
      const roleIds = [
        proposer.roleId,
        reviewer.roleId,
        foreignReviewer.roleId,
        foreignProposer.roleId,
      ];
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
      foreignProposer,
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

      // A recommendation does not reserve a canonical ISBN, but independent reviewers
      // must not accept that same new ISBN for two different catalog products.
      const proposedIsbn = '9780000000003';
      const foreignPath = base + f.storeB.id + '/catalog-corrections';
      const firstIsbn = await app.inject({
        method: 'POST',
        url: foreignPath,
        headers: bearer(f.foreignProposer.token),
        payload: {
          skuId: f.skuB.id,
          expectedInventoryVersion: 1,
          field: 'isbn',
          proposedValue: proposedIsbn,
          reason: 'Checked a physical sample for store B',
        },
      });
      expect(firstIsbn.statusCode).toBe(201);
      const firstId = catalogCorrectionRecordSchema.parse(firstIsbn.json()).id;
      const firstVerdict = await app.inject({
        method: 'POST',
        url: foreignPath + '/' + firstId + '/review',
        headers: bearer(f.foreignReviewer.token),
        payload: { verdict: 'ACCEPTED', reason: 'Independent catalog verification' },
      });
      expect(firstVerdict.statusCode).toBe(200);

      const secondIsbn = await app.inject({
        method: 'POST',
        url: path,
        headers: bearer(f.proposer.token),
        payload: {
          skuId: f.skuA.id,
          expectedInventoryVersion: 2,
          field: 'isbn',
          proposedValue: proposedIsbn,
          reason: 'Conflicting catalog recommendation for store A',
        },
      });
      expect(secondIsbn.statusCode).toBe(201);
      const secondId = catalogCorrectionRecordSchema.parse(secondIsbn.json()).id;
      const secondVerdict = await app.inject({
        method: 'POST',
        url: path + '/' + secondId + '/review',
        headers: bearer(f.reviewer.token),
        payload: { verdict: 'ACCEPTED', reason: 'Should be blocked by ISBN conflict' },
      });
      expect(secondVerdict.statusCode).toBe(409);
      const unchanged = await db
        .select({ isbn: bookEditions.isbn })
        .from(bookEditions)
        .where(inArray(bookEditions.isbn, ['9780000000001', '9780000000002']));
      expect(unchanged).toHaveLength(2);
    } finally {
      await app.close();
      await f.cleanup();
    }
  });
  it('keeps an old PENDING proposal reachable beyond 50 newer decided records', async () => {
    const f = await fixture();
    try {
      const [sku] = await db
        .select({ productId: skus.productId })
        .from(skus)
        .where(eq(skus.id, f.skuA.id));
      const [pending] = await db
        .insert(catalogCorrectionRequests)
        .values({
          storeId: f.storeA.id,
          skuId: f.skuA.id,
          sourceProductId: sku!.productId,
          field: 'bookTitle',
          originalValue: 'Original Book A',
          proposedValue: 'Old pending recommendation',
          expectedInventoryVersion: 2,
          reason: 'Older request still needs review',
          requestedByStaffAccountId: f.proposer.id,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        })
        .returning();
      await db.insert(catalogCorrectionRequests).values(
        Array.from({ length: 62 }, (_, i) => ({
          storeId: f.storeA.id,
          skuId: f.skuA.id,
          sourceProductId: sku!.productId,
          field: 'bookTitle',
          originalValue: 'Original Book A',
          proposedValue: 'Already rejected ' + i,
          expectedInventoryVersion: 2,
          reason: 'Archived history',
          status: 'REJECTED',
          requestedByStaffAccountId: f.proposer.id,
          reviewedByStaffAccountId: f.reviewer.id,
          reviewReason: 'No supporting evidence',
          reviewedAt: new Date(),
        })),
      );
      const first = await corrections.list(f.storeA.id, { offset: 0, limit: 20 });
      expect(first.requests[0]?.id).toBe(pending!.id);
      expect(first.requests[0]?.status).toBe('PENDING');
      expect(first.hasMore).toBe(true);
      const pages = await Promise.all(
        [0, 20, 40, 60].map((offset) =>
          corrections.list(f.storeA.id, { offset, limit: 20 }),
        ),
      );
      const ids = pages.flatMap((page) => page.requests.map((row) => row.id));
      expect(ids).toHaveLength(63);
      expect(new Set(ids).size).toBe(63);
      expect(pages[3]?.hasMore).toBe(false);
      expect(pages[3]?.requests).toHaveLength(3);
      expect((await corrections.list(f.storeB.id, { offset: 0, limit: 20 })).requests).toEqual([]);
      const reviewed = await corrections.review(
        f.storeA.id,
        pending!.id,
        f.reviewer.id,
        randomUUID(),
        { verdict: 'REJECTED', reason: 'Old request independently reviewed' },
      );
      expect(reviewed.status).toBe('REJECTED');
      const [master] = await db
        .select({ title: books.title })
        .from(books)
        .where(eq(books.id, f.bookA.id));
      expect(master?.title).toBe('Original Book A');
    } finally {
      await f.cleanup();
    }
  });

  it('rejects stale ACCEPTED when HQ edits canonical book while the reviewer waits', async () => {
    const f = await fixture();
    try {
      const created = await corrections.submit(f.storeA.id, f.proposer.id, randomUUID(), {
        skuId: f.skuA.id,
        expectedInventoryVersion: 2,
        field: 'bookTitle',
        proposedValue: 'Proposed new book title',
        reason: 'Check the cover before recommending to HQ',
      });
      let releaseHq: () => void = () => undefined;
      const allowCommit = new Promise<void>((resolve) => {
        releaseHq = resolve;
      });
      let signalHqLocked: () => void = () => undefined;
      const hqLocked = new Promise<void>((resolve) => {
        signalHqLocked = resolve;
      });
      const hqEdit = db.transaction(async (tx) => {
        await tx
          .update(books)
          .set({ title: 'HQ concurrent title change' })
          .where(eq(books.id, f.bookA.id));
        signalHqLocked();
        await allowCommit;
      });
      await hqLocked;
      // Review starts while the HQ transaction holds a write lock. An
      // out-of-transaction SELECT would see the obsolete original title.
      const reviewAttempt = corrections.review(
        f.storeA.id,
        created.id,
        f.reviewer.id,
        randomUUID(),
        { verdict: 'ACCEPTED', reason: 'Checking canonical source concurrently' },
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        releaseHq();
      }
      await hqEdit;
      await expect(reviewAttempt).rejects.toMatchObject({ code: 'CONFLICT' });
      const [stillPending] = await db
        .select()
        .from(catalogCorrectionRequests)
        .where(eq(catalogCorrectionRequests.id, created.id));
      expect(stillPending?.status).toBe('PENDING');
      const reviews = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, created.id));
      expect(reviews.filter((row) => row.actionKey === 'catalog.correction.review')).toHaveLength(0);
      expect(reviews.filter((row) => row.actionKey === 'catalog.correction.submit')).toHaveLength(1);
      const [stock] = await db
        .select()
        .from(storeInventory)
        .where(and(eq(storeInventory.storeId, f.storeA.id), eq(storeInventory.skuId, f.skuA.id)));
      expect(stock).toMatchObject({ onHand: 5, version: 2 });
    } finally {
      await f.cleanup();
    }
  });

});
