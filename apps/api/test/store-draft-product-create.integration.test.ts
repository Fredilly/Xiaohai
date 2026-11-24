import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  createDatabase,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

// All inserts/deletes in this file are isolated fixtures, never live merchant
// data; enforce the effective TEST_DATABASE_URL allowlist before any pool opens.
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

suite('Store draft product creation on disposable PostgreSQL', () => {
  const db = database!.db;
  const commerce = new CommerceService(db);
  afterAll(async () => {
    await database!.pool.end();
  });

  it('atomically links a zero-stock draft and deduplicates authenticated retries', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'store-draft-' + suffix + '@example.com',
        passwordHash: 'test-only',
      })
      .returning({ id: staffAccounts.id });
    const [region] = await db
      .insert(regions)
      .values({
        code: 'DRAFT-R-' + suffix,
        name: 'Draft isolated region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const [store] = await db
      .insert(stores)
      .values({
        code: 'DRAFT-S-' + suffix,
        name: 'Draft isolated store',
        regionId: region!.id,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Test only',
        latitude: 30,
        longitude: 104,
      })
      .returning({ id: stores.id });

    let productId: string | null = null;
    let skuId: string | null = null;
    try {
      const input = {
        name: 'Store draft non-book ' + suffix,
        description: 'Test fixture only',
        coverUrl: 'https://assets.example.com/merchant/fixture.jpg',
        status: 'DRAFT' as const,
        book: null,
        sku: {
          code: 'DRAFT-SKU-' + suffix,
          name: '盒装',
          priceMinor: 2500,
          status: 'ACTIVE' as const,
          availableForSale: false,
        },
      };
      const requestKey = 'store-draft-idempotency-' + suffix;
      const first = await commerce.createStoreDraftProduct(
        input,
        actor!.id,
        randomUUID(),
        store!.id,
        requestKey,
      );
      productId = first.id;
      skuId = first.skuId;
      expect(first.status).toBe('DRAFT');
      expect(first.book).toBeNull();
      expect(first.sku.availableForSale).toBe(false);

      const retry = await commerce.createStoreDraftProduct(
        input,
        actor!.id,
        randomUUID(),
        store!.id,
        requestKey,
      );
      expect(retry.id).toBe(first.id);
      expect(retry.skuId).toBe(first.skuId);
      await expect(
        commerce.createStoreDraftProduct(
          { ...input, sku: { ...input.sku, priceMinor: 3000 } },
          actor!.id,
          randomUUID(),
          store!.id,
          requestKey,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        commerce.createStoreDraftProduct(
          { ...input, status: 'ACTIVE' },
          actor!.id,
          randomUUID(),
          store!.id,
          'another-request-key',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

      const balances = await db
        .select()
        .from(storeInventory)
        .where(eq(storeInventory.skuId, first.skuId));
      expect(balances).toHaveLength(1);
      expect(balances[0]).toMatchObject({
        storeId: store!.id,
        onHand: 0,
        reserved: 0,
        rentalReserved: 0,
      });

      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actionKey: 'catalog.store_create',
        resourceType: 'PRODUCT',
        resourceId: first.id,
      });
      expect(logs[0]?.metadata).toMatchObject({
        linkedStoreId: store!.id,
        initialOnHand: 0,
        skuCount: 1,
      });
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      if (skuId) {
        await db.delete(storeInventory).where(eq(storeInventory.skuId, skuId));
        await db.delete(skus).where(eq(skus.id, skuId));
      }
      if (productId) await db.delete(products).where(eq(products.id, productId));
      await db.delete(stores).where(eq(stores.id, store!.id));
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
