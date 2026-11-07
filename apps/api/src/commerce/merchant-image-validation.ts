export type MerchantImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const extensionByMime: Record<MerchantImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
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
const maxBase64Length = Math.ceil((MAX_MERCHANT_IMAGE_BYTES * 4) / 3) + 4;
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngFooter = Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]);

function isPng(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(pngHeader)) return false;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return false;
  if (!bytes.subarray(-8).equals(pngFooter)) return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || width > 8192) return false;
  if (height < 1 || height > 8192) return false;
  return true;
}

function isJpeg(bytes: Buffer): boolean {
  if (bytes[0] !== 0xff) return false;
  if (bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  if (bytes[bytes.length - 2] !== 0xff) return false;
  return bytes[bytes.length - 1] === 0xd9;
}

function isWebp(bytes: Buffer): boolean {
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF') return false;
  if (bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  const fourCC = bytes.subarray(12, 16).toString('ascii');
  return ['VP8 ', 'VP8L', 'VP8X'].includes(fourCC);
}

export function decodeMerchantImage(base64: string, mimeType: MerchantImageType): Buffer {
  if (!base64 || base64.length > maxBase64Length) {
    throw new ProductImageError('INVALID_IMAGE');
  }
  if (!canonicalBase64.test(base64)) {
    throw new ProductImageError('INVALID_IMAGE');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 24 || bytes.length > MAX_MERCHANT_IMAGE_BYTES) {
    throw new ProductImageError('INVALID_IMAGE');
  }
  if (bytes.toString('base64') !== base64) {
    throw new ProductImageError('INVALID_IMAGE');
  }
  if (mimeType === 'image/png' && isPng(bytes)) return bytes;
  if (mimeType === 'image/jpeg' && isJpeg(bytes)) return bytes;
  if (mimeType === 'image/webp' && isWebp(bytes)) return bytes;
  throw new ProductImageError('INVALID_IMAGE');
}
