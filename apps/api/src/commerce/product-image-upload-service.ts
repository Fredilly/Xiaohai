import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  auditLogs,
  productMedia,
  products,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import type { MerchantImageStorage } from './merchant-image-storage.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Connection = Db | Tx;

export type MerchantImageType = 'image/jpeg' | 'image/png' | 'image/webp';
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

export type ProductImageErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_IMAGE'
  | 'SHARED_FORBIDDEN'
  | 'MEDIA_UNAVAILABLE';

export class ProductImageError extends Error {
  constructor(readonly code: ProductImageErrorCode) {
    super(code);
  }
}

export const MAX_MERCHANT_IMAGE_BYTES = 2 * 1024 * 1024;

export function decodeMerchantImage(base64: string, mimeType: MerchantImageType): Buffer {
  if (
    !base64 ||
    base64.length > Math.ceil((MAX_MERCHANT_IMAGE_BYTES * 4) / 3) + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new ProductImageError('INVALID_IMAGE');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.byteLength < 24 ||
    bytes.byteLength > MAX_MERCHANT_IMAGE_BYTES ||
    bytes.toString('base64') !== base64
  ) {
    throw new ProductImageError('INVALID_IMAGE');
  }

  const png =
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR' &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(16) <= 8192 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.readUInt32BE(20) <= 8192 &&
    bytes.subarray(-8).equals(Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]));
  const jpeg =
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;
  const webp =
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP' &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii'));

  if (
    (mimeType === 'image/png' && png) ||
    (mimeType === 'image/jpeg' && jpeg) ||
    (mimeType === 'image/webp' && webp)
  ) {
    return bytes;
  }
  throw new ProductImageError('INVALID_IMAGE');
}

export class ProductImageUploadService {
  constructor(
    private readonly db: Db,
    private readonly storage: MerchantImageStorage | null,
  ) {}

  async upload(input: Upload) {
    if (!this.storage) throw new ProductImageError('MEDIA_UNAVAILABLE');
    const body = decodeMerchantImage(input.base64, input.mimeType);
    // The exact same bytes always resolve to the same immutable object key.
    // A browser retry cannot overwrite a different image at the prior key.
    const hash = createHash('sha256').update(body).digest('hex');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
      input.mimeType
    ];
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
    const candidate = new URL(imageUrl);
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
}
