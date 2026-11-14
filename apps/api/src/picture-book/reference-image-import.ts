import baiduSdk from '@baiducloud/sdk';
import { createHash } from 'node:crypto';

export const MAX_REFERENCE_PNG_BYTES = 3 * 1024 * 1024;

export type ImportedReferenceAsset = {
  objectKey: string;
  playbackUrl: string;
  byteSize: number;
};

export type ReferenceImageStorage = {
  upload(input: { objectKey: string; body: Buffer }): Promise<ImportedReferenceAsset>;
};

export class InvalidReferencePngError extends Error {
  constructor() {
    super('INVALID_REFERENCE_PNG');
  }
}

export function decodeReferencePng(base64: string): Buffer {
  if (
    !base64 ||
    base64.length > Math.ceil((MAX_REFERENCE_PNG_BYTES * 4) / 3) + 4 ||
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new InvalidReferencePngError();
  }
  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.length < 58 ||
    bytes.length > MAX_REFERENCE_PNG_BYTES ||
    !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new InvalidReferencePngError();
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    bytes[24] !== 8 ||
    ![2, 6].includes(bytes[25]!) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  ) {
    throw new InvalidReferencePngError();
  }
  let offset = 8;
  let firstChunk = true;
  let foundIdat = false;
  let foundEnd = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const next = offset + 12 + size;
    if (size > MAX_REFERENCE_PNG_BYTES || next > bytes.length) {
      throw new InvalidReferencePngError();
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (firstChunk && type !== 'IHDR') throw new InvalidReferencePngError();
    firstChunk = false;
    if (
      pngCrc32(bytes.subarray(offset + 4, offset + 8 + size)) !==
      bytes.readUInt32BE(offset + 8 + size)
    ) {
      throw new InvalidReferencePngError();
    }
    if (type === 'IDAT') foundIdat = true;
    if (type === 'IEND') {
      if (size !== 0 || next !== bytes.length) throw new InvalidReferencePngError();
      foundEnd = true;
      break;
    }
    offset = next;
  }
  if (!foundIdat || !foundEnd) throw new InvalidReferencePngError();
  return bytes;
}

// PNG CRC validation checks object integrity before sending bytes to BOS.
function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function referenceObjectKey(input: {
  consumerUserId: string;
  pictureBookId: string;
  characterId: string;
  image: Buffer;
}): string {
  const digest = createHash('sha256').update(input.image).digest('hex');
  return `picture-books/character-references/i111/${input.consumerUserId}/${input.pictureBookId}/${input.characterId}/${digest}.png`;
}

export function isIsolatedReferenceImportDatabase(env: NodeJS.ProcessEnv): boolean {
  if (env.APP_ENV !== 'dev' || env.NODE_ENV === 'production') return false;
  const expected = env.PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME;
  if (!expected || !/^xiaohai_i111_[a-z0-9_]{8,32}$/.test(expected)) return false;
  if (!env.DATABASE_URL) return false;
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return false;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
    if (url.pathname !== '/' + expected) return false;
    if (!url.username || !url.password || url.search || url.hash) return false;
    if (env.NODE_ENV === 'test') return env.TEST_DATABASE_URL === env.DATABASE_URL;
    return !env.TEST_DATABASE_URL;
  } catch {
    return false;
  }
}

// Independently verify the actual PostgreSQL database reached by the pool.
export async function isConnectedToIsolatedReferenceDatabase(
  env: NodeJS.ProcessEnv,
  query: () => Promise<{ rows: { name: string }[] }>,
): Promise<boolean> {
  if (!isIsolatedReferenceImportDatabase(env)) return false;
  try {
    const result = await query();
    if (result.rows.length !== 1) return false;
    return result.rows[0]?.name === env.PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME;
  } catch {
    return false;
  }
}

// This narrow acceptance-only capability is intentionally OFF in all staging/production
// environments, even if someone accidentally sets the feature flag there.
type ReferenceBosClient = {
  putObject(
    bucketName: string,
    objectKey: string,
    body: Buffer,
    headers: { 'Content-Type': string; 'Content-Length': number },
  ): Promise<unknown>;
  getObjectMetadata(bucketName: string, objectKey: string): Promise<unknown>;
};

// The official BOS JS SDK exposes response.http_headers for getObjectMetadata.
// Keep this function injectable to test the real PUT -> HEAD contract offline.
export async function uploadVerifiedReferenceToBos(
  client: ReferenceBosClient,
  bucket: string,
  origin: string,
  input: { objectKey: string; body: Buffer },
): Promise<ImportedReferenceAsset> {
  if (
    !/^picture-books\/character-references\/i111\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f]{64}\.png$/.test(
      input.objectKey,
    )
  ) {
    throw new Error('INVALID_REFERENCE_OBJECT_KEY');
  }
  await client.putObject(bucket, input.objectKey, input.body, {
    'Content-Type': 'image/png',
    'Content-Length': input.body.byteLength,
  });
  const response: unknown = await client.getObjectMetadata(bucket, input.objectKey);
  if (!response || typeof response !== 'object' || !('http_headers' in response)) {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  const headers = response.http_headers;
  if (!headers || typeof headers !== 'object') {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  const values = new Map<string, unknown>();
  for (const [key, value] of Object.entries(headers)) {
    values.set(key.toLowerCase(), value);
  }
  const length = values.get('content-length');
  const mime = values.get('content-type');
  if (!/^(0|[1-9][0-9]*)$/.test(String(length ?? ''))) {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  if (Number(length) !== input.body.byteLength) {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  if (typeof mime !== 'string' || mime.toLowerCase() !== 'image/png') {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  // When BOS supplies an MD5 integrity proof, verify it, do not ignore it.
  const contentMd5 = values.get('content-md5');
  if (contentMd5 != null && typeof contentMd5 !== 'string') {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  if (
    typeof contentMd5 === 'string' &&
    contentMd5 !== createHash('md5').update(input.body).digest('base64')
  ) {
    throw new Error('REFERENCE_BOS_METADATA_UNVERIFIED');
  }
  return {
    objectKey: input.objectKey,
    playbackUrl: `${origin}/${input.objectKey}`,
    byteSize: Number(length),
  };
}

export function createIsolatedReferenceImageStorage(
  env: NodeJS.ProcessEnv,
): ReferenceImageStorage | null {
  if (
    env.APP_ENV !== 'dev' ||
    env.NODE_ENV === 'production' ||
    env.PICTURE_BOOK_REFERENCE_IMPORT_ENABLED !== 'true' ||
    !isIsolatedReferenceImportDatabase(env)
  ) {
    return null;
  }
  const endpoint = env.BAIDU_BOS_ENDPOINT;
  const origin = env.BAIDU_BOS_PUBLIC_ORIGIN;
  const bucket = env.BAIDU_BOS_BUCKET;
  const ak = env.BAIDU_BOS_ACCESS_KEY_ID;
  const sk = env.BAIDU_BOS_SECRET_ACCESS_KEY;
  if (!endpoint || !origin || !bucket || !ak || !sk) return null;
  if ([endpoint, origin, bucket, ak, sk].some((value) => value.startsWith('INJECT_'))) {
    return null;
  }
  if (!/^xiaohai-i111-[a-z0-9-]{4,40}$/.test(bucket)) return null;
  try {
    const e = new URL(endpoint);
    const o = new URL(origin);
    if (
      e.protocol !== 'https:' ||
      o.protocol !== 'https:' ||
      !e.hostname.endsWith('.bcebos.com') ||
      o.hostname !== `${bucket}.${e.hostname}` ||
      e.username ||
      e.password ||
      e.search ||
      e.hash ||
      e.port ||
      e.pathname !== '/' ||
      o.username ||
      o.password ||
      o.search ||
      o.hash ||
      o.port ||
      o.pathname !== '/'
    ) {
      return null;
    }
  } catch {
    return null;
  }

  // Verify actual BOS HTTP metadata before exposing a READY revision.
  const client = new baiduSdk.BosClient({
    endpoint,
    credentials: { ak, sk },
  }) as unknown as ReferenceBosClient;
  return {
    upload(input) {
      return uploadVerifiedReferenceToBos(client, bucket, origin, input);
    },
  };
}
