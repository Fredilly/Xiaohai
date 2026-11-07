import baiduSdk from '@baiducloud/sdk';

export type MerchantImageStorage = {
  putImage(input: { objectKey: string; body: Buffer; mimeType: string }): Promise<string>;
};

type BosPutClient = {
  putObject(
    bucket: string,
    key: string,
    body: Buffer,
    options: { 'Content-Type': string; 'Content-Length': number },
  ): Promise<unknown>;
};

export function createMerchantImageStorage(
  env: NodeJS.ProcessEnv,
  clientOverride?: BosPutClient,
): MerchantImageStorage | null {
  // Separate least-privilege credentials are required. Never fall back to the
  // private picture-book playback credentials or enable public bucket writes.
  const endpoint = env.PRODUCT_BOS_ENDPOINT;
  const origin = env.PRODUCT_BOS_PUBLIC_ORIGIN;
  const bucket = env.PRODUCT_BOS_BUCKET;
  const ak = env.PRODUCT_BOS_ACCESS_KEY_ID;
  const sk = env.PRODUCT_BOS_SECRET_ACCESS_KEY;
  if (!endpoint || !origin || !bucket || !ak || !sk) return null;
  if ([endpoint, origin, bucket, ak, sk].some((value) => value.startsWith('INJECT_'))) {
    return null;
  }
  if (!/^[a-z0-9-]{4,63}$/.test(bucket)) return null;

  try {
    const target = new URL(endpoint);
    const publicOrigin = new URL(origin);
    if (
      target.protocol !== 'https:' ||
      !target.hostname.endsWith('.bcebos.com') ||
      target.hostname.split('.').length !== 3 ||
      target.pathname !== '/' ||
      target.username ||
      target.password ||
      target.port ||
      target.search ||
      target.hash ||
      publicOrigin.protocol !== 'https:' ||
      publicOrigin.hostname !== `${bucket}.${target.hostname}` ||
      publicOrigin.pathname !== '/' ||
      publicOrigin.port ||
      publicOrigin.username ||
      publicOrigin.password ||
      publicOrigin.search ||
      publicOrigin.hash
    ) {
      return null;
    }
  } catch {
    return null;
  }

  // The vendor SDK exposes putObject at runtime, but its published
  // TypeScript definition does not declare it. Validate the actual client
  // method rather than forcing a type assertion or attempting a write.
  const clientCandidate: unknown =
    clientOverride ??
    new baiduSdk.BosClient({
      endpoint,
      credentials: { ak, sk },
    });
  if (
    !clientCandidate ||
    typeof clientCandidate !== 'object' ||
    !('putObject' in clientCandidate) ||
    typeof clientCandidate.putObject !== 'function'
  ) {
    return null;
  }
  const client: BosPutClient = clientCandidate as BosPutClient;

  return {
    async putImage({ objectKey, body, mimeType }) {
      if (!/^products\/[a-f0-9-]{36}\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(objectKey)) {
        throw new Error('Invalid merchant image object key');
      }
      await client.putObject(bucket, objectKey, body, {
        'Content-Type': mimeType,
        'Content-Length': body.byteLength,
      });
      return `${new URL(origin).origin}/${objectKey}`;
    },
  };
}
