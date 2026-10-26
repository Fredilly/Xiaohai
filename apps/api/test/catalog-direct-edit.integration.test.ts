import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  products,
  regions,
  rolePermissions,
  roles,
  permissions,
  skus,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  storeCatalogMetadata,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CatalogEditService, type CatalogEditError } from '../src/commerce/catalog-edit-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { StoreNetworkService } from '../src/stores/store-service.js';
import {
  registerStoreCatalogEditRoutes,
  registerStoreCatalogReadRoutes,
} from '../src/commerce/store-catalog-read-routes.js';

const databaseUrl = process.env.DATABASE_URL;
const disposableDatabase =
  databaseUrl && /^xiaohai_(test|pr157_uat)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
const suite = disposableDatabase ? describe : describe.skip;

suite('direct catalog editing on disposable PostgreSQL', () => {
  const db = disposableDatabase!.db;
  const editor = new CatalogEditService(db, 'isolated-catalog-impact-test-signing-secret-12345');
  const reader = new StoreCatalogReadService(db);

  afterAll(async () => {
    await disposableDatabase!.pool.end();
  });

  it('updates shared fields and keeps store-local metadata and stock unchanged', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [region] = await db
      .insert(regions)
      .values({
        code: 'DCE-R-' + suffix,
        name: 'Direct Catalog Test Region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning();
    const [storeA, storeB] = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((letter) => ({
          code: 'DCE-S-' + letter + '-' + suffix,
          name: 'Direct Catalog Store ' + letter,
          regionId: region!.id,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Test only',
          latitude: 30,
          longitude: 104,
        })),
      )
      .returning();
    const [book] = await db
      .insert(books)
      .values({ title: 'Original Direct Edit Book', author: 'Original Author' })
      .returning();
    const [edition] = await db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: null, publisher: 'Test Publisher' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({
        bookEditionId: edition!.id,
        name: 'Original Direct Edit Product',
        status: 'ACTIVE',
      })
      .returning();
    const [sku] = await db
      .insert(skus)
      .values({
        productId: product!.id,
        code: 'DCE-SKU-' + suffix,
        name: 'Edition',
        priceMinor: 1000,
      })
      .returning();
    await db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: sku!.id, onHand: 6 },
      { storeId: storeB!.id, skuId: sku!.id, onHand: 4 },
    ]);
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'dce-' + randomUUID() + '@example.com',
        passwordHash: 'test-only',
      })
      .returning();
    const [role] = await db
      .insert(roles)
      .values({ key: 'dce-' + randomUUID(), displayName: 'Isolated Catalog Edit Tester' })
      .returning();
    for (const key of ['stores.read', 'inventory.read', 'catalog.edit']) {
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
      scopeId: storeA!.id,
    });

    try {
      const input = {
        expectedProductVersion: 0,
        expectedBookVersion: 0,
        expectedEditionVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        bookTitle: 'Edited Direct Edit Book',
        priceMinor: 1200,
        shelfLocation: 'Shelf A-01',
      };

      const preview = await editor.preview(storeA!.id, sku!.id, input, actor!.id, true);
      expect(preview.impact.sharedFields).toEqual(['bookTitle', 'priceMinor']);
      expect(preview.impact.affectedStoreCount).toBe(2);
      expect(preview.previewToken).toMatch(/^\d{10}\./);

      await expect(
        editor.update(storeA!.id, sku!.id, actor!.id, randomUUID(), input, true),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        editor.update(
          storeA!.id,
          sku!.id,
          randomUUID(),
          randomUUID(),
          input,
          true,
          preview.previewToken!,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        editor.update(storeA!.id, sku!.id, actor!.id, randomUUID(), input),
      ).rejects.toMatchObject({ code: 'SHARED_FORBIDDEN' });

      const updated = await editor.update(
        storeA!.id,
        sku!.id,
        actor!.id,
        randomUUID(),
        input,
        true,
        preview.previewToken!,
      );
      expect(updated.item.bookTitle).toBe('Edited Direct Edit Book');
      expect(updated.item.priceMinor).toBe(1200);
      expect(updated.item.shelfLocation).toBe('Shelf A-01');
      expect(updated.item.bookVersion).toBe(1);
      expect(updated.item.skuVersion).toBe(1);
      expect(updated.item.localVersion).toBe(1);
      expect(updated.impact.affectedStoreCount).toBe(2);

      const otherStore = await reader.get(storeB!.id, sku!.id);
      expect(otherStore?.bookTitle).toBe('Edited Direct Edit Book');
      expect(otherStore?.priceMinor).toBe(1200);
      expect(otherStore?.shelfLocation).toBeNull();

      await expect(
        editor.update(
          storeA!.id,
          sku!.id,
          actor!.id,
          randomUUID(),
          input,
          true,
          preview.previewToken!,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Partial<CatalogEditError>);

      const changedImpactEdit = {
        ...input,
        expectedBookVersion: 1,
        expectedSkuVersion: 1,
        expectedLocalVersion: 1,
        bookTitle: 'New HQ book title after scoped preview',
      };
      const changedPreview = await editor.preview(
        storeA!.id,
        sku!.id,
        changedImpactEdit,
        actor!.id,
        true,
      );
      expect(changedPreview.impact.affectedStoreCount).toBe(2);
      // A store becomes unlinked after the preview; versions remain unchanged,
      // but the server must reject the old acknowledgement.
      await db
        .delete(storeInventory)
        .where(and(eq(storeInventory.storeId, storeB!.id), eq(storeInventory.skuId, sku!.id)));
      await expect(
        editor.update(
          storeA!.id,
          sku!.id,
          actor!.id,
          randomUUID(),
          changedImpactEdit,
          true,
          changedPreview.previewToken!,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const afterInvalidImpact = await reader.get(storeA!.id, sku!.id);
      expect(afterInvalidImpact?.bookTitle).toBe('Edited Direct Edit Book');
      await db.insert(storeInventory).values({ storeId: storeB!.id, skuId: sku!.id, onHand: 4 });

      const balances = await db
        .select({ storeId: storeInventory.storeId, onHand: storeInventory.onHand })
        .from(storeInventory)
        .where(eq(storeInventory.skuId, sku!.id));
      expect(balances).toHaveLength(2);
      expect(balances.find((row) => row.storeId === storeA!.id)?.onHand).toBe(6);
      expect(balances.find((row) => row.storeId === storeB!.id)?.onHand).toBe(4);

      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actionKey).toBe('catalog.direct_edit');
      expect(audit[0]?.metadata).toMatchObject({
        affectedStoreCount: 2,
        changedFields: ['bookTitle', 'priceMinor', 'shelfLocation'],
      });

      // Real signed Staff session + DB-backed role/scope; no user password or token is read.
      const sessions = new StaffSessionService(
        'isolated-direct-catalog-scope-test-secret-123456',
        300,
      );
      const authorization = new StaffAuthorizationService(
        new DrizzleStaffAuthorizationRepository(db),
        sessions,
      );
      const app = buildApp({ logger: false });
      const options = {
        staffAuthorization: authorization,
        stores: new StoreNetworkService(db),
      };
      registerStoreCatalogReadRoutes(app, { ...options, catalog: reader });
      registerStoreCatalogEditRoutes(app, { ...options, catalog: editor });
      const headers = { authorization: 'Bearer ' + sessions.issue(actor!.id).token };
      const ownUrl = `/api/v1/staff/stores/${storeA!.id}/catalog`;
      const foreignUrl = `/api/v1/staff/stores/${storeB!.id}/catalog`;
      const foreignEditUrl = `${foreignUrl}/${sku!.id}`;
      const foreignEditPayload = {
        expectedProductVersion: 1,
        expectedBookVersion: 1,
        expectedEditionVersion: 0,
        expectedSkuVersion: 1,
        expectedLocalVersion: 0,
        storeNote: 'Should never be saved',
      };
      try {
        const ownRead = await app.inject({ method: 'GET', url: ownUrl, headers });
        expect(ownRead.statusCode).toBe(200);
        const ownReadBody = ownRead.json<{ items: unknown[] }>();
        expect(ownReadBody.items).toHaveLength(1);

        const bypassShared = {
          expectedProductVersion: 0,
          expectedBookVersion: 1,
          expectedSkuVersion: 1,
          expectedLocalVersion: 1,
          bookTitle: 'Cross-store malicious title',
        };
        const deniedSharedPreview = await app.inject({
          method: 'POST',
          url: ownUrl + '/' + sku!.id + '/preview',
          headers,
          payload: bypassShared,
        });
        expect(deniedSharedPreview.statusCode).toBe(403);
        const deniedSharedPatch = await app.inject({
          method: 'PATCH',
          url: ownUrl + '/' + sku!.id,
          headers,
          payload: bypassShared,
        });
        expect(deniedSharedPatch.statusCode).toBe(403);
        expect((await reader.get(storeA!.id, sku!.id))?.bookTitle).toBe('Edited Direct Edit Book');

        const deniedRead = await app.inject({ method: 'GET', url: foreignUrl, headers });
        expect(deniedRead.statusCode).toBe(403);
        const deniedEdit = await app.inject({
          method: 'PATCH',
          url: foreignEditUrl,
          headers,
          payload: foreignEditPayload,
        });
        expect(deniedEdit.statusCode).toBe(403);

        // Grant and revoke the second store while retaining the same signed session.
        await db.insert(staffDataScopes).values({
          staffAccountId: actor!.id,
          scopeType: 'STORE',
          scopeId: storeB!.id,
        });
        const newlyAuthorizedRead = await app.inject({
          method: 'GET',
          url: foreignUrl,
          headers,
        });
        expect(newlyAuthorizedRead.statusCode).toBe(200);

        await db
          .delete(staffDataScopes)
          .where(
            and(
              eq(staffDataScopes.staffAccountId, actor!.id),
              eq(staffDataScopes.scopeType, 'STORE'),
              eq(staffDataScopes.scopeId, storeB!.id),
            ),
          );
        const revokedRead = await app.inject({ method: 'GET', url: foreignUrl, headers });
        expect(revokedRead.statusCode).toBe(403);
        const revokedEdit = await app.inject({
          method: 'PATCH',
          url: foreignEditUrl,
          headers,
          payload: foreignEditPayload,
        });
        expect(revokedEdit.statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: ownUrl, headers })).statusCode).toBe(200);
      } finally {
        await app.close();
      }
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(staffDataScopes).where(eq(staffDataScopes.staffAccountId, actor!.id));
      await db.delete(staffRoles).where(eq(staffRoles.staffAccountId, actor!.id));
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
      await db.delete(roles).where(eq(roles.id, role!.id));
      await db
        .delete(storeCatalogMetadata)
        .where(
          and(
            eq(storeCatalogMetadata.storeId, storeA!.id),
            eq(storeCatalogMetadata.skuId, sku!.id),
          ),
        );
      await db.delete(storeInventory).where(eq(storeInventory.skuId, sku!.id));
      await db.delete(skus).where(eq(skus.id, sku!.id));
      await db.delete(products).where(eq(products.id, product!.id));
      await db.delete(bookEditions).where(eq(bookEditions.id, edition!.id));
      await db.delete(books).where(eq(books.id, book!.id));
      await db.delete(stores).where(eq(stores.id, storeA!.id));
      await db.delete(stores).where(eq(stores.id, storeB!.id));
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
