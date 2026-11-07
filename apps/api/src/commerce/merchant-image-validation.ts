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

