import baiduSdk from '@baiducloud/sdk';

export type PlaybackAsset = {
  provider: string;
  objectKey: string;
  playbackUrl: string | null;
};
export type MediaPlaybackResolver = (asset: PlaybackAsset) => string | null;

type Presigner = {
  generatePresignedUrl(
    bucket: string,
    key: string,
    timestampSeconds: number,
    expirationSeconds: number,
  ): string;
};

export const PRIVATE_IMAGE_TTL_SECONDS = 300;

// Call only after the existing consumer session + picture-book ownership check.
// The stored unsigned URL is metadata, never authorization for the object.
export function createPrivateBosPlaybackResolver(
  env: NodeJS.ProcessEnv,
  signerOverride?: Presigner,
  now: () => number = Date.now,
): MediaPlaybackResolver {
  const endpoint = env.BAIDU_BOS_ENDPOINT;
  const origin = env.BAIDU_BOS_PUBLIC_ORIGIN;
  const bucket = env.BAIDU_BOS_BUCKET;
  const ak = env.BAIDU_BOS_ACCESS_KEY_ID;
  const sk = env.BAIDU_BOS_SECRET_ACCESS_KEY;
  const disabled: MediaPlaybackResolver = () => null;

  // Missing or placeholder secrets must never expose the bare BOS URL.
  if (!endpoint || !origin || !bucket || !ak || !sk) return disabled;
  if ([endpoint, origin, bucket, ak, sk].some((value) => value.startsWith('INJECT_')))
    return disabled;
  if (!/^[a-z0-9-]{4,63}$/.test(bucket)) return disabled;

  let endpointHost: string;
  let originHost: string;
  try {
    const e = new URL(endpoint);
    const o = new URL(origin);
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
    ) return disabled;
    endpointHost = e.hostname;
    originHost = o.hostname;
  } catch {
    return disabled;
  }

  const signer: Presigner =
    signerOverride ??
    new baiduSdk.BosClient({
      endpoint,
      credentials: { ak, sk },
    });

  return (asset) => {
    if (asset.provider !== 'BAIDU_BOS' || !asset.playbackUrl) return null;
    const key = asset.objectKey;
    if (
      !key.startsWith('picture-books/') ||
      key.length > 512 ||
      !/^[A-Za-z0-9_/%.-]+\.png$/.test(key) ||
      key.split('/').some((segment) => segment === '.' || segment === '..' || !segment)
    ) return null;

    const path = `/${key.split('/').map(encodeURIComponent).join('/')}`;
    try {
      // Only sign media whose canonical address belongs to THIS private bucket.
      const recorded = new URL(asset.playbackUrl);
      if (
        recorded.protocol !== 'https:' ||
        recorded.hostname !== originHost ||
        recorded.port ||
        recorded.pathname !== path ||
        recorded.search ||
        recorded.hash ||
        recorded.username ||
        recorded.password
      ) return null;

      const signed = new URL(signer.generatePresignedUrl(
        bucket,
        key,
        Math.floor(now() / 1000),
        PRIVATE_IMAGE_TTL_SECONDS,
      ));
      if (
        signed.protocol !== 'https:' ||
        (signed.hostname !== endpointHost && signed.hostname !== originHost) ||
        signed.port ||
        signed.username ||
        signed.password ||
        !signed.search ||
        ![path, `/${bucket}${path}`].includes(signed.pathname)
      ) return null;
      return signed.toString();
    } catch {
      // Never fall back to a public or unsigned URL.
      return null;
    }
  };
}
