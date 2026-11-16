import baiduSdk from '@baiducloud/sdk';

export type PrivateBosReferenceAsset = {
  provider: string;
  objectKey: string;
  playbackUrl: string | null;
};

export type PrivateBosReferenceResolver = (
  asset: PrivateBosReferenceAsset,
) => string | null;

type Presigner = {
  generatePresignedUrl(
    bucket: string,
    key: string,
    timestampSeconds: number,
    expirationSeconds: number,
  ): string;
};

export const PRIVATE_REFERENCE_TTL_SECONDS = 300;

/**
 * Sign ONLY existing, validated character-reference objects for a paid
 * provider's temporary image input. Stored BOS playback URLs are UNSIGNED
 * metadata and must never be sent to Bailian or used as an auth fallback.
 */
export function createPrivateBosReferenceResolver(
  env: {
    endpoint?: string;
    publicOrigin?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  },
  signerOverride?: Presigner,
  now: () => number = Date.now,
): PrivateBosReferenceResolver {
  const { endpoint, publicOrigin, bucket, accessKeyId, secretAccessKey } = env;
  const disabled: PrivateBosReferenceResolver = () => null;
  if (!endpoint || !publicOrigin || !bucket || !accessKeyId || !secretAccessKey) {
    return disabled;
  }
  if ([endpoint, publicOrigin, bucket, accessKeyId, secretAccessKey].some((value) => value.startsWith('INJECT_'))) {
    return disabled;
  }
  if (!/^[a-z0-9-]{4,63}$/.test(bucket)) return disabled;

  let endpointHost: string;
  let originHost: string;
  try {
    const e = new URL(endpoint);
    const o = new URL(publicOrigin);
    if (
      e.protocol !== 'https:' ||
      o.protocol !== 'https:' ||
      e.username ||
      o.username ||
      e.password ||
      o.password ||
      e.pathname !== '/' ||
      o.pathname !== '/' ||
      e.port ||
      o.port ||
      e.search ||
      o.search ||
      e.hash ||
      o.hash ||
      !e.hostname.endsWith('.bcebos.com') ||
      o.hostname !== `${bucket}.${e.hostname}`
    ) {
      return disabled;
    }
    endpointHost = e.hostname;
    originHost = o.hostname;
  } catch {
    return disabled;
  }

  // Match the SDK's actual /<key> object path (without an SDK /v1/ prefix).
  // This was proven with real private GET during Issue #111 Gate B.
  const signer: Presigner =
    signerOverride ??
    new baiduSdk.BosClient({
      endpoint,
      credentials: { ak: accessKeyId, sk: secretAccessKey },
      removeVersionPrefix: true,
    });

  return (asset) => {
    if (asset.provider !== 'BAIDU_BOS' || !asset.playbackUrl) return null;
    const key = asset.objectKey;
    if (
      !key.startsWith('picture-books/character-references/') ||
      key.length > 512 ||
      !/^[A-Za-z0-9_/%.-]+\.png$/.test(key) ||
      key.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      return null;
    }

    const path = `/${key.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const recorded = new URL(asset.playbackUrl);
      // The original #111 imported references include one historical extra
      // slash; preserve that narrowly scoped exception without signing it.
      const i111LegacyPath =
        /^picture-books\/character-references\/i111\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f]{64}\.png$/.test(
          key,
        ) && recorded.pathname === `/${path}`;
      if (
        recorded.protocol !== 'https:' ||
        recorded.hostname !== originHost ||
        recorded.port ||
        (recorded.pathname !== path && !i111LegacyPath) ||
        recorded.search ||
        recorded.hash ||
        recorded.username ||
        recorded.password
      ) {
        return null;
      }

      const signed = new URL(
        signer.generatePresignedUrl(
          bucket,
          key,
          Math.floor(now() / 1000),
          PRIVATE_REFERENCE_TTL_SECONDS,
        ),
      );
      if (
        signed.protocol !== 'https:' ||
        (signed.hostname !== endpointHost && signed.hostname !== originHost) ||
        signed.port ||
        signed.username ||
        signed.password ||
        !signed.search ||
        ![path, `/${bucket}${path}`].includes(signed.pathname)
      ) {
        return null;
      }
      return signed.toString();
    } catch {
      // Never fall back to an unsigned address or log a signed query.
      return null;
    }
  };
}
