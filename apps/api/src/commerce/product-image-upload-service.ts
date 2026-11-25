import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
  productMedia,
  products,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import type { MerchantImageStorage } from './merchant-image-storage.js';
import {
  merchantProductGalleryResponseSchema,
  type MerchantProductGalleryUpdate,
} from '@xiaohai/contracts/commerce';
import {
  ProductImageError,
  decodeMerchantImage,
  extensionByMime,
  type MerchantImageType,
} from './merchant-image-validation.js';
import { publicProductGalleryUrls } from './product-public-media.js';
export { ProductImageError, decodeMerchantImage } from './merchant-image-validation.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Connection = Db | Tx;

type Upload = {
  productId: string;
  expectedProductVersion: number;
  mimeType: MerchantImageType;
  base64: string;
  actorStaffAccountId: string;
  requestId: string;
  /** null means globally authorized HQ; a Store may only affect its one Store. */
  scopedStoreId: string | null;
};

export class ProductImageUploadService {
  constructor(
    private readonly db: Db,
    private readonly storage: MerchantImageStorage | null,
  ) {}

  async listGallery(productId: string, scopedStoreId: string | null) {
    const [product] = await this.db
      .select({
        id: products.id,
        version: products.version,
        status: products.status,
        coverUrl: products.coverUrl,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product) throw new ProductImageError('NOT_FOUND');
    if (scopedStoreId) await this.assertStoreProductLinked(this.db, productId, scopedStoreId);
    const images = await this.db
      .select({
        id: productMedia.id,
        url: productMedia.url,
        displayOrder: productMedia.displayOrder,
      })
      .from(productMedia)
      .where(eq(productMedia.productId, productId))
      .orderBy(asc(productMedia.displayOrder), asc(productMedia.id))
      .limit(40);
    return merchantProductGalleryResponseSchema.parse({
      productId: product.id,
      productVersion: product.version,
      productStatus: product.status,
      coverUrl: product.coverUrl,
      images,
    });
  }

  async updateGallery(
    input: MerchantProductGalleryUpdate & {
      productId: string;
      scopedStoreId: string | null;
      actorStaffAccountId: string;
      requestId: string;
    },
  ) {
    if (
      input.imageIds.length > 12 ||
      new Set(input.imageIds).size !== input.imageIds.length ||
      (input.imageIds.length === 0) !== (input.coverImageId === null) ||
      (input.coverImageId !== null && !input.imageIds.includes(input.coverImageId))
    )
      throw new ProductImageError('INVALID_IMAGE');
    return this.db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          id: products.id,
          version: products.version,
          status: products.status,
          coverUrl: products.coverUrl,
        })
        .from(products)
        .where(eq(products.id, input.productId))
        .for('update');
      if (!product) throw new ProductImageError('NOT_FOUND');
      if (product.status !== 'DRAFT' || product.version !== input.expectedProductVersion) {
        throw new ProductImageError('CONFLICT');
      }
      const skuRows = await tx
        .select({ id: skus.id })
        .from(skus)
        .where(eq(skus.productId, input.productId))
        .orderBy(asc(skus.id))
        .for('update');
      if (!skuRows.length) throw new ProductImageError('CONFLICT');
      await this.assertAffectedStores(tx, input.productId, input.scopedStoreId);

      const existing = await tx
        .select({
          id: productMedia.id,
          url: productMedia.url,
          displayOrder: productMedia.displayOrder,
        })
        .from(productMedia)
        .where(eq(productMedia.productId, input.productId))
        .orderBy(asc(productMedia.displayOrder), asc(productMedia.id))
        .limit(13);
      if (existing.length > 12) throw new ProductImageError('CONFLICT');
      const byId = new Map(existing.map((image) => [image.id, image]));
      if (input.imageIds.some((id) => !byId.has(id))) throw new ProductImageError('INVALID_IMAGE');
      const selectedUrls = input.imageIds.map((id) => byId.get(id)!.url);
      if (publicProductGalleryUrls(selectedUrls, 12).length !== selectedUrls.length) {
        throw new ProductImageError('INVALID_IMAGE');
      }
      const coverUrl = input.coverImageId ? byId.get(input.coverImageId)!.url : null;
      const changed =
        coverUrl !== product.coverUrl ||
        JSON.stringify(existing.map((image) => image.id)) !== JSON.stringify(input.imageIds) ||
        existing.some((image, index) => image.displayOrder !== index);
      const images = input.imageIds.map((id, displayOrder) => ({
        id,
        url: byId.get(id)!.url,
        displayOrder,
      }));
      if (!changed) {
        return merchantProductGalleryResponseSchema.parse({
          productId: input.productId,
          productVersion: product.version,
          productStatus: product.status,
          coverUrl,
          images,
        });
      }

      const removed = existing.filter((image) => !input.imageIds.includes(image.id));
      if (removed.length) {
        await tx.delete(productMedia).where(
          and(
            eq(productMedia.productId, input.productId),
            inArray(
              productMedia.id,
              removed.map((image) => image.id),
            ),
          ),
        );
      }
      for (const image of images) {
        await tx
          .update(productMedia)
          .set({ displayOrder: image.displayOrder })
          .where(and(eq(productMedia.productId, input.productId), eq(productMedia.id, image.id)));
      }
      const [updated] = await tx
        .update(products)
        .set({ coverUrl, version: sql`${products.version} + 1`, updatedAt: new Date() })
        .where(and(eq(products.id, input.productId), eq(products.version, product.version)))
        .returning({ version: products.version });
      if (!updated) throw new ProductImageError('CONFLICT');
      await tx.insert(auditLogs).values({
        actorStaffAccountId: input.actorStaffAccountId,
        actionKey: 'catalog.product_gallery_update',
        resourceType: 'PRODUCT',
        resourceId: input.productId,
        requestId: input.requestId,
        metadata: {
          storeId: input.scopedStoreId,
          beforeProductVersion: product.version,
          afterProductVersion: updated.version,
          beforeImageIds: existing.map((image) => image.id),
          afterImageIds: input.imageIds,
          removedImageIds: removed.map((image) => image.id),
          coverImageId: input.coverImageId,
        },
      });
      // Removing a DB reference never deletes immutable BOS objects.
      return merchantProductGalleryResponseSchema.parse({
        productId: input.productId,
        productVersion: updated.version,
        productStatus: product.status,
        coverUrl,
        images,
      });
    });
  }

  async upload(input: Upload) {
    if (!this.storage) throw new ProductImageError('MEDIA_UNAVAILABLE');
    const body = decodeMerchantImage(input.base64, input.mimeType);
    // The exact same bytes always resolve to the same immutable object key.
    // A browser retry cannot overwrite a different image at the prior key.
    const hash = createHash('sha256').update(body).digest('hex');
    const ext = extensionByMime[input.mimeType];
    const objectKey = `products/${input.productId}/images/${hash}.${ext}`;

    // Reject unscoped/active/stale product requests BEFORE any BOS PUT.
    await this.assertUploadAllowed(this.db, input);
    let imageUrl: string;
    try {
      imageUrl = await this.storage.putImage({ objectKey, body, mimeType: input.mimeType });
    } catch {
      // Cloud upload errors are deliberately redacted from logs and responses.
      throw new ProductImageError('MEDIA_UNAVAILABLE');
    }
    let candidate: URL;
    try {
      candidate = new URL(imageUrl);
    } catch {
      throw new ProductImageError('MEDIA_UNAVAILABLE');
    }
    if (
      candidate.protocol !== 'https:' ||
      !candidate.hostname.endsWith('.bcebos.com') ||
      candidate.pathname !== '/' + objectKey ||
      candidate.search ||
      candidate.hash ||
      candidate.username ||
      candidate.password ||
      candidate.port
    ) {
      throw new ProductImageError('MEDIA_UNAVAILABLE');
    }

    // A second Store may link this shared product during upload. Re-check
    // under a product/SKU lock: the remote object may remain unreferenced on
    // conflict, but the DB never exposes or applies a cross-store edit.
    return this.db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          id: products.id,
          version: products.version,
          status: products.status,
          coverUrl: products.coverUrl,
        })
        .from(products)
        .where(eq(products.id, input.productId))
        .for('update');
      if (!product) throw new ProductImageError('NOT_FOUND');
      if (product.status !== 'DRAFT' || product.version !== input.expectedProductVersion) {
        throw new ProductImageError('CONFLICT');
      }
      const skuRows = await tx
        .select({ id: skus.id })
        .from(skus)
        .where(eq(skus.productId, input.productId))
        .orderBy(asc(skus.id))
        .for('update');
      if (!skuRows.length) throw new ProductImageError('CONFLICT');
      await this.assertAffectedStores(tx, input.productId, input.scopedStoreId);

      const images = await tx
        .select({ id: productMedia.id, url: productMedia.url })
        .from(productMedia)
        .where(eq(productMedia.productId, input.productId))
        .orderBy(asc(productMedia.displayOrder), asc(productMedia.id))
        .limit(9);

      const already = images.find((image) => image.url === imageUrl);
      if (already) {
        // Duplicate same-bytes request does not append an image or bump version.
        return {
          imageId: already.id,
          url: imageUrl,
          coverUrl: product.coverUrl,
          productVersion: product.version,
          duplicate: true,
        };
      }
      if (images.length >= 8) throw new ProductImageError('CONFLICT');

      const [added] = await tx
        .insert(productMedia)
        .values({
          productId: input.productId,
          url: imageUrl,
          displayOrder: images.length,
        })
        .returning({ id: productMedia.id });
      const coverUrl = product.coverUrl || imageUrl;
      const [updated] = await tx
        .update(products)
        .set({
          coverUrl,
          version: sql`${products.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, input.productId), eq(products.version, product.version)))
        .returning({ version: products.version });
      if (!updated || !added) throw new ProductImageError('CONFLICT');

      await tx.insert(auditLogs).values({
        actorStaffAccountId: input.actorStaffAccountId,
        actionKey: 'catalog.product_image_upload',
        resourceType: 'PRODUCT',
        resourceId: input.productId,
        requestId: input.requestId,
        metadata: {
          storeId: input.scopedStoreId,
          productId: input.productId,
          objectKey,
          mimeType: input.mimeType,
          byteSize: body.length,
          imageId: added.id,
          beforeProductVersion: product.version,
          afterProductVersion: updated.version,
        },
      });
      return {
        imageId: added.id,
        url: imageUrl,
        coverUrl,
        productVersion: updated.version,
        duplicate: false,
      };
    });
  }

  private async assertUploadAllowed(db: Connection, input: Upload) {
    const [product] = await db
      .select({ version: products.version, status: products.status })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new ProductImageError('NOT_FOUND');
    if (product.status !== 'DRAFT' || product.version !== input.expectedProductVersion) {
      throw new ProductImageError('CONFLICT');
    }
    await this.assertAffectedStores(db, input.productId, input.scopedStoreId);
  }

  private async assertAffectedStores(db: Connection, productId: string, storeId: string | null) {
    if (!storeId) return; // Only the separately authorized GLOBAL/HQ route may pass null.
    const affected = await db
      .selectDistinct({ storeId: storeInventory.storeId })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .where(eq(skus.productId, productId));
    if (affected.length !== 1 || affected[0]?.storeId !== storeId) {
      throw new ProductImageError('SHARED_FORBIDDEN');
    }
  }

  private async assertStoreProductLinked(db: Connection, productId: string, storeId: string) {
    const [linked] = await db
      .select({ skuId: skus.id })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .where(and(eq(skus.productId, productId), eq(storeInventory.storeId, storeId)))
      .limit(1);
    if (!linked) throw new ProductImageError('NOT_FOUND');
  }
}
