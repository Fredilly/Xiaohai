import type { createDatabase } from '@xiaohai/db';
import { BailianImageProvider } from './image-provider.js';
import { ImageJobProcessor } from './image-processor.js';
import { createBaiduBosStorage } from './bos-storage.js';
import { createPrivateBosReferenceResolver } from './private-bos-reference.js';
import { createI111SinglePaidFetch } from './i111-single-paid-fetch.js';

const TARGET_STOP = 'I111_SOURCE_BOUND_TARGET_STOP';
const BOS_BUCKET = 'xiaohai-i111-work-2ec3900280';
const BOS_ENDPOINT = 'https://cd.bcebos.com/';
const BOS_ORIGIN = `https://${BOS_BUCKET}.cd.bcebos.com/`;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

type Db = ReturnType<typeof createDatabase>['db'];

export type I111TargetWorkerOptions = {
  db: Db;
  targetIllustrationId: string;
  workspaceId: string;
  apiKey: string;
  imageTimeoutMs: number;
  bos: {
    endpoint: string;
    bucket: string;
    publicOrigin: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  logger?: { error: (fields: Record<string, unknown>, message: string) => void };
};

/**
 * Construct the actual Worker production classes, never the generic Worker
 * entrypoint. The only claimable DB row is targetIllustrationId, and the real
 * Bailian provider is restricted to one exact POST plus one temporary GET.
 *
 * This factory makes NO DB, TCP, BOS or provider requests. Its output MUST be
 * called only inside a trusted, independently reviewed one-shot coordinator
 * holding the actual exclusive DB/runtime boundary and fresh owner grant.
 */
export function createI111SourceBoundTargetWorker(options: I111TargetWorkerOptions) {
  const { db, targetIllustrationId, workspaceId, apiKey, imageTimeoutMs, bos, logger } = options;
  if (
    process.env.APP_ENV !== 'dev' ||
    !db ||
    typeof db.transaction !== 'function' ||
    !UUID.test(targetIllustrationId) ||
    !Number.isSafeInteger(imageTimeoutMs) ||
    imageTimeoutMs < 600_000 ||
    imageTimeoutMs > 780_000 ||
    typeof apiKey !== 'string' ||
    apiKey.length < 8 ||
    apiKey.startsWith('INJECT_') ||
    !bos ||
    bos.bucket !== BOS_BUCKET ||
    bos.endpoint !== BOS_ENDPOINT ||
    bos.publicOrigin !== BOS_ORIGIN ||
    [bos.accessKeyId, bos.secretAccessKey].some(
      (value) => typeof value !== 'string' || value.length < 8 || value.startsWith('INJECT_'),
    )
  )
    throw new Error(TARGET_STOP);

  // Constructing these classes is side-effect-free. Their real methods remain
  // unusable until the separate DB/approval/atomic gates grant exactly one call.
  const transport = createI111SinglePaidFetch({ fetcher: fetch, workspaceId });
  const storage = createBaiduBosStorage({
    endpoint: bos.endpoint,
    bucket: bos.bucket,
    publicOrigin: bos.publicOrigin,
    accessKeyId: bos.accessKeyId,
    secretAccessKey: bos.secretAccessKey,
  });
  const referenceResolver = createPrivateBosReferenceResolver(bos);
  const provider = new BailianImageProvider(
    apiKey,
    `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,
    storage,
    transport.fetcher,
  );
  const processor = new ImageJobProcessor(
    db,
    provider,
    imageTimeoutMs,
    logger,
    referenceResolver,
    targetIllustrationId,
  );
  let consumed = false;

  return Object.freeze({
    async processOne(): Promise<string | null> {
      if (consumed) throw new Error(TARGET_STOP);
      // An unknown DB/provider result consumes the only attempt; no fallback.
      consumed = true;
      try {
        const id = await processor.processOne();
        if (id !== targetIllustrationId) throw new Error(TARGET_STOP);
        return id;
      } catch {
        // Do not disclose provider, BOS, DB, or SDK errors to the caller.
        throw new Error(TARGET_STOP);
      }
    },
    transportUsageSummary: transport.usageSummary,
  });
}
