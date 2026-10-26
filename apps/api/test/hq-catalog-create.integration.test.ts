import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  products,
  skus,
  staffAccounts,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';

const databaseUrl = process.env.DATABASE_URL;
const disposableDatabase =
  databaseUrl && new URL(databaseUrl).pathname === '/xiaohai_test'
    ? createDatabase(process.env)
    : null;
const suite = disposableDatabase ? describe : describe.skip;

suite('HQ catalog create and optimistic update on disposable PostgreSQL', () => {
  const db = disposableDatabase!.db;
  const commerce = new CommerceService(db);

  afterAll(async () => {
    await disposableDatabase!.pool.end();
  });

  it('returns the committed creation, audits the actor, and rejects a stale HQ update', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'hq-catalog-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    let createdId: string | null = null;
    try {
      const input = {
        name: 'HQ Catalog Integration ' + suffix,
        description: 'Isolated database fixture',
        status: 'ACTIVE' as const,
        book: {
          title: 'HQ Book ' + suffix,
          author: 'Fixture author',
          publisher: 'Fixture publisher',
          isbn: null,
        },
        sku: {
          code: 'HQ-SKU-' + suffix,
          name: 'Standard Edition',
          priceMinor: 2500,
          status: 'ACTIVE' as const,
          availableForSale: true,
        },
      };
      const createRequestId = randomUUID();
      const created = await commerce.createAdminProduct(input, actor!.id, createRequestId);
      createdId = created.id;
      expect(created.id).toBeTruthy();
      expect(created.productVersion).toBe(0);
      expect(created.skuVersion).toBe(0);
      expect(created.book?.title).toBe(input.book.title);
      expect(created.sku.priceMinor).toBe(2500);

      const persisted = (await commerce.listAdminProducts()).products.find(
        (product) => product.id === created.id,
      );
      expect(persisted).toEqual(created);

      const [creationAudit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.requestId, createRequestId));
      expect(creationAudit).toMatchObject({
        actorStaffAccountId: actor!.id,
        actionKey: 'catalog.hq_create',
        resourceType: 'PRODUCT',
        resourceId: created.id,
      });
      expect(creationAudit?.metadata).toMatchObject({
        changedFields: ['product', 'book', 'edition', 'sku'],
        skuCount: 1,
      });

      const updated = await commerce.updateAdminProduct(
        created.id,
        {
          ...input,
          name: 'Updated HQ catalog fixture',
          expectedProductVersion: 0,
          expectedSkuVersion: 0,
        },
        actor!.id,
        randomUUID(),
      );
      expect(updated.productVersion).toBe(1);
      expect(updated.skuVersion).toBe(1);

      await expect(
        commerce.updateAdminProduct(
          created.id,
          {
            ...input,
            name: 'Stale overwrite must not succeed',
            expectedProductVersion: 0,
            expectedSkuVersion: 0,
          },
          actor!.id,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const [finalProduct] = await db
        .select({ name: products.name, version: products.version })
        .from(products)
        .where(eq(products.id, created.id));
      expect(finalProduct).toMatchObject({
        name: 'Updated HQ catalog fixture',
        version: 1,
      });

      const audit = await db
        .select({ actionKey: auditLogs.actionKey })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit.map((row) => row.actionKey).sort()).toEqual([
        'catalog.hq_create',
        'catalog.hq_direct_edit',
      ]);
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      if (createdId) {
        const [product] = await db
          .select({ bookEditionId: products.bookEditionId })
          .from(products)
          .where(eq(products.id, createdId));
        await db.delete(skus).where(eq(skus.productId, createdId));
        await db.delete(products).where(eq(products.id, createdId));
        if (product?.bookEditionId) {
          const [edition] = await db
            .select({ bookId: bookEditions.bookId })
            .from(bookEditions)
            .where(eq(bookEditions.id, product.bookEditionId));
          await db.delete(bookEditions).where(eq(bookEditions.id, product.bookEditionId));
          if (edition?.bookId) {
            await db.delete(books).where(eq(books.id, edition.bookId));
          }
        }
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });

  it('uses targeted readback and idempotently replays after a committed read failure', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'hq-replay-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    const base = {
      name: 'Idempotent HQ fixture ' + suffix,
      status: 'ACTIVE' as const,
      book: null,
      sku: {
        code: 'HQ-IDEMPOTENT-' + suffix,
        name: 'Test SKU',
        priceMinor: 1200,
        status: 'ACTIVE' as const,
        availableForSale: true,
      },
    };
    const key = 'create-' + suffix;
    try {
      const other = await commerce.createAdminProduct(
        { ...base, name: 'Other HQ fixture ' + suffix, sku: { ...base.sku, code: 'OTHER-' + suffix } },
        actor!.id,
        randomUUID(),
        'other-' + suffix,
      );
      const listSpy = vi.spyOn(commerce, 'listAdminProducts');
      const readSpy = vi
        .spyOn(commerce, 'getAdminProductById')
        .mockRejectedValueOnce(new Error('simulated post-commit readback failure'));

      // Insert and audit commit before the response fails. The second HTTP
      // request has a new request ID but reuses the original idempotency key.
      await expect(
        commerce.createAdminProduct(base, actor!.id, randomUUID(), key),
      ).rejects.toThrow('simulated post-commit readback failure');
      readSpy.mockRestore();

      const recovered = await commerce.createAdminProduct(base, actor!.id, randomUUID(), key);
      expect(recovered.name).toBe(base.name);
      expect(recovered.id).not.toBe(other.id);
      expect(recovered.sku.code).toBe(base.sku.code);
      expect(recovered.productVersion).toBe(0);
      expect(listSpy).not.toHaveBeenCalled();

      const [sameOne, sameTwo] = await Promise.all([
        commerce.createAdminProduct(base, actor!.id, randomUUID(), key),
        commerce.createAdminProduct(base, actor!.id, randomUUID(), key),
      ]);
      expect(sameOne.id).toBe(recovered.id);
      expect(sameTwo.id).toBe(recovered.id);

      await expect(
        commerce.createAdminProduct(
          { ...base, name: 'Changed request must be rejected' },
          actor!.id,
          randomUUID(),
          key,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, base.name));
      expect(rows.map((item) => item.id)).toEqual([recovered.id]);

      const creationAudits = await db
        .select({ resourceId: auditLogs.resourceId })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(creationAudits).toHaveLength(2);
      expect(creationAudits.map((item) => item.resourceId).sort()).toEqual(
        [other.id, recovered.id].sort(),
      );
    } finally {
      vi.restoreAllMocks();
      const creationAudits = await db
        .select({ resourceId: auditLogs.resourceId })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      for (const { resourceId } of creationAudits) {
        if (resourceId) {
          await db.delete(skus).where(eq(skus.productId, resourceId));
          await db.delete(products).where(eq(products.id, resourceId));
        }
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });

});
