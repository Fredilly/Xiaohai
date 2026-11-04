import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CatalogEditService } from '../src/commerce/catalog-edit-service.js';

const databaseUrl = process.env.DATABASE_URL;
const disposable =
  databaseUrl && /^xiaohai_(test|pr157_uat)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
const suite = disposable ? describe : describe.skip;

function postgresCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; cause?: unknown };
  return e.code === code || (e.cause !== error && postgresCode(e.cause, code));
}

suite('shared catalog dependency serialization on disposable PostgreSQL', () => {
  const db = disposable!.db;
  const editor = new CatalogEditService(db, 'test-impact-serialization-secret-123456789');

  afterAll(async () => {
    await disposable!.pool.end();
  });

  it('blocks a third-store inventory link through another product and edition while HQ commits book title', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [region] = await db
      .insert(regions)
      .values({
        code: 'CSI-R-' + suffix,
        name: 'Catalog serialization test',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning();
    const storeRows = await db
      .insert(stores)
      .values(
        ['A', 'B', 'C'].map((letter) => ({
          code: 'CSI-' + letter + '-' + suffix,
          name: 'Catalog serialization store ' + letter,
          regionId: region!.id,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable test only',
          latitude: 30,
          longitude: 104,
        })),
      )
      .returning();
    const [storeA, storeB, storeC] = storeRows;
    const [book] = await db
      .insert(books)
      .values({ title: 'Shared serialization title', author: 'Synthetic author' })
      .returning();
    // Different edition, different product and different SKU, but same book.
    const editionRows = await db
      .insert(bookEditions)
      .values([
        { bookId: book!.id, publisher: 'First publisher' },
        { bookId: book!.id, publisher: 'Second publisher' },
      ])
      .returning();
    const productRows = await db
      .insert(products)
      .values([
        { bookEditionId: editionRows[0]!.id, name: 'Main edition', status: 'ACTIVE' },
        { bookEditionId: editionRows[1]!.id, name: 'Alternate edition', status: 'ACTIVE' },
      ])
      .returning();
    const skuRows = await db
      .insert(skus)
      .values([
        {
          productId: productRows[0]!.id,
          code: 'CSI-MAIN-' + suffix,
          name: 'Main',
          priceMinor: 1000,
        },
        {
          productId: productRows[1]!.id,
          code: 'CSI-ALT-' + suffix,
          name: 'Alternate',
          priceMinor: 1100,
        },
      ])
      .returning();
    const [selectedSku, alternateSku] = skuRows;
    await db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: selectedSku!.id, onHand: 2 },
      { storeId: storeB!.id, skuId: selectedSku!.id, onHand: 3 },
    ]);
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'csi-' + randomUUID() + '@example.com',
        passwordHash: 'test-only',
      })
      .returning();

    let releaseAudit: () => void = () => undefined;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let lockedActor: () => void = () => undefined;
    const actorLocked = new Promise<void>((resolve) => {
      lockedActor = resolve;
    });
    let blocker: Promise<unknown> | undefined;
    let update: Promise<unknown> | undefined;
    let link: Promise<unknown> | undefined;

    try {
      const input = {
        expectedProductVersion: 0,
        expectedBookVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        bookTitle: 'HQ serialized title',
      };
      const preview = await editor.preview(storeA!.id, selectedSku!.id, input, actor!.id, true);
      expect(preview.impact.affectedStoreIds.sort()).toEqual([storeA!.id, storeB!.id].sort());

      // Audit INSERT requires FK KEY SHARE on actor. Hold actor's row exclusively
      // so HQ pauses only AFTER acquiring shared master locks and writing title.
      blocker = db.transaction(async (tx) => {
        await tx
          .select({ id: staffAccounts.id })
          .from(staffAccounts)
          .where(eq(staffAccounts.id, actor!.id))
          .for('update');
        lockedActor();
        await auditGate;
      });
      await actorLocked;

      update = editor.update(
        storeA!.id,
        selectedSku!.id,
        actor!.id,
        randomUUID(),
        input,
        true,
        preview.previewToken!,
      );

      // Poll the *different* SKU with a non-blocking FK-style lock probe. Old
      // implementation only locked selectedSku and fails this assertion.
      let alternateSkuProtected = false;
      for (let attempt = 0; attempt < 75; attempt += 1) {
        try {
          await db.execute(
            sql`SELECT id FROM skus WHERE id = ${alternateSku!.id} FOR KEY SHARE NOWAIT`,
          );
        } catch (error) {
          if (!postgresCode(error, '55P03')) throw error;
          alternateSkuProtected = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(alternateSkuProtected).toBe(true);

      let linkCompleted = false;
      link = db
        .insert(storeInventory)
        .values({ storeId: storeC!.id, skuId: alternateSku!.id, onHand: 1 })
        .then(() => {
          linkCompleted = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The FK on *alternateSku* must block insertion until HQ completes.
      expect(linkCompleted).toBe(false);
      releaseAudit();
      await Promise.all([blocker, update, link]);

      const [title] = await db
        .select({ title: books.title })
        .from(books)
        .where(eq(books.id, book!.id));
      expect(title?.title).toBe('HQ serialized title');
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit?.metadata).toMatchObject({ affectedStoreCount: 2 });
      const impact = audit?.metadata as { affectedStoreIds?: string[] } | undefined;
      expect(impact?.affectedStoreIds?.sort()).toEqual([storeA!.id, storeB!.id].sort());
      const [newLink] = await db
        .select()
        .from(storeInventory)
        .where(eq(storeInventory.storeId, storeC!.id));
      expect(newLink?.skuId).toBe(alternateSku!.id);
    } finally {
      releaseAudit();
      await Promise.allSettled([blocker, update, link].filter((p) => p !== undefined));
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(storeInventory).where(
        inArray(
          storeInventory.skuId,
          skuRows.map((r) => r.id),
        ),
      );
      await db.delete(skus).where(
        inArray(
          skus.id,
          skuRows.map((r) => r.id),
        ),
      );
      await db.delete(products).where(
        inArray(
          products.id,
          productRows.map((r) => r.id),
        ),
      );
      await db.delete(bookEditions).where(
        inArray(
          bookEditions.id,
          editionRows.map((r) => r.id),
        ),
      );
      await db.delete(books).where(eq(books.id, book!.id));
      await db.delete(stores).where(
        inArray(
          stores.id,
          storeRows.map((r) => r.id),
        ),
      );
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
