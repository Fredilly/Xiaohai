import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  createDatabase,
  productMedia,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import {
  decodeMerchantImage,
  ProductImageUploadService,
} from '../src/commerce/product-image-upload-service.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7n0AAAAASUVORK5CYII=';

// Fail closed before establishing a connection to anything but the approved
// local disposable PostgreSQL test database.
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

describe('merchant photo file validation', () => {
  it('allows a canonical PNG but rejects script, mismatched MIME and oversized input', () => {
    expect(decodeMerchantImage(ONE_PIXEL_PNG, 'image/png').byteLength).toBeGreaterThan(30);
    for (const [content, mime] of [
      [Buffer.from('<svg onload=alert(1)>').toString('base64'), 'image/png'],
      [ONE_PIXEL_PNG, 'image/jpeg'],
      ['!!!not-base64', 'image/png'],
      ['a'.repeat(2_796_210), 'image/png'],
    ] as const) {
      expect(() => decodeMerchantImage(content, mime)).toThrowError('INVALID_IMAGE');
    }
  });
});

suite('scoped draft photo upload transaction (disposable PostgreSQL only)', () => {
  const db = database!.db;
  afterAll(async () => {
    await database!.pool.end();
  });

  it('creates an audited gallery image and refuses both shared and active goods', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: 'image-' + suffix + '@example.com', passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    const [region] = await db
      .insert(regions)
      .values({
        code: 'IMG-R-' + suffix,
        name: 'Isolated image region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const linked = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((label) => ({
          code: 'IMG-S-' + label + '-' + suffix,
          name: 'Image test store ' + label,
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
      .returning({ id: stores.id });
    const first = linked[0]!.id;
    const second = linked[1]!.id;
    const [product] = await db
      .insert(products)
      .values({ name: 'Merchant draft for photo', status: 'DRAFT' })
      .returning({ id: products.id });
    const [sku] = await db
      .insert(skus)
      .values({
        productId: product!.id,
        code: 'IMG-SKU-' + suffix,
        name: 'standard',
        priceMinor: 1000,
        availableForSale: false,
      })
      .returning({ id: skus.id });
    await db.insert(storeInventory).values({ storeId: first, skuId: sku!.id, onHand: 0 });
    let remoteUploads = 0;
    const putImage = vi.fn(async (image: { objectKey: string }) => {
      remoteUploads++;
      return `https://merchant-test.cd.bcebos.com/${image.objectKey}`;
    });
    const service = new ProductImageUploadService(db, { putImage });
    const request = {
      productId: product!.id,
      expectedProductVersion: 0,
      mimeType: 'image/png' as const,
      base64: ONE_PIXEL_PNG,
      actorStaffAccountId: actor!.id,
      requestId: randomUUID(),
      scopedStoreId: first,
    };
    try {
      const firstImage = await service.upload(request);
      expect(firstImage.duplicate).toBe(false);
      expect(firstImage.productVersion).toBe(1);
      expect(firstImage.coverUrl).toBe(firstImage.url);
      expect(firstImage.url).toContain('/products/' + product!.id + '/images/');
      expect(remoteUploads).toBe(1);
      const [persisted] = await db.select().from(products).where(eq(products.id, product!.id));
      expect(persisted?.coverUrl).toBe(firstImage.url);
      expect(persisted?.version).toBe(1);
      const storedMedia = await db
        .select()
        .from(productMedia)
        .where(eq(productMedia.productId, product!.id));
      expect(storedMedia).toHaveLength(1);
      expect(storedMedia[0]?.url).toBe(firstImage.url);

      const duplicate = await service.upload({ ...request, expectedProductVersion: 1 });
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.productVersion).toBe(1);
      expect(
        await db.select().from(productMedia).where(eq(productMedia.productId, product!.id)),
      ).toHaveLength(1);
      await expect(service.upload(request)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(remoteUploads).toBe(2);

      await db.insert(storeInventory).values({ storeId: second, skuId: sku!.id, onHand: 0 });
      await expect(service.upload({ ...request, expectedProductVersion: 1 })).rejects.toMatchObject(
        { code: 'SHARED_FORBIDDEN' },
      );
      expect(remoteUploads).toBe(2);
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actionKey: 'catalog.product_image_upload',
        resourceId: product!.id,
      });

      await db.update(products).set({ status: 'ACTIVE' }).where(eq(products.id, product!.id));
      await expect(
        service.upload({ ...request, expectedProductVersion: 1, scopedStoreId: null }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(remoteUploads).toBe(2);
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(productMedia).where(eq(productMedia.productId, product!.id));
      await db.delete(storeInventory).where(eq(storeInventory.skuId, sku!.id));
      await db.delete(skus).where(eq(skus.id, sku!.id));
      await db.delete(products).where(eq(products.id, product!.id));
      for (const store of linked) await db.delete(stores).where(eq(stores.id, store.id));
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
