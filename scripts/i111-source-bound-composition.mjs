import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const STOP = 'I111_SOURCE_BOUND_COMPOSITION_STOP';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const SLOTS = Object.freeze([
  Object.freeze({ pageId: scope.page1Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 2, regenerate: true }),
]);

function fail() {
  throw new Error(STOP);
}

function matchesSlot(actual, expected) {
  return (
    actual &&
    typeof actual === 'object' &&
    Object.keys(actual).length === 3 &&
    actual.pageId === expected.pageId &&
    actual.revisionNumber === expected.revisionNumber &&
    actual.regenerate === expected.regenerate
  );
}

/**
 * Source-bind only the TWO missing operational ports to the built production
 * PictureBookService and ImageJobProcessor classes. No callback can substitute
 * a fake API service, generic Worker, or pre-consumed boolean gate.
 *
 * This is deliberately NOT a live coordinator or executable CLI. It does not
 * implement/read a trusted snapshot, authenticate compiled artifacts, check
 * independent approval, or acquire the exclusive DB lock. It MUST be used only
 * by a future reviewed composition root that independently supplies those
 * controls and authenticates the exact build. Construction performs no
 * network, database or provider operation.
 */
export async function createI111SourceBoundComposition({
  db,
  workspaceId,
  apiKey,
  imageTimeoutMs,
  bos,
  logger,
}) {
  if (process.env.APP_ENV !== 'dev' || !db || typeof db.transaction !== 'function') fail();

  // Import exact built project modules, not caller-supplied factories. Missing
  // or unbuilt modules are a hard STOP; never fall back to a mock or generic
  // Worker. Import is side-effect-free; the ports remain inert until invoked.
  let createApi;
  let createWorker;
  try {
    ({ createI111SourceBoundFormalApiService: createApi } =
      await import('../apps/api/dist/picture-book/i111-source-bound-service.js'));
    ({ createI111SourceBoundTargetWorker: createWorker } =
      await import('../apps/worker/dist/i111-source-bound-target.js'));
  } catch {
    fail();
  }
  if (typeof createApi !== 'function' || typeof createWorker !== 'function') fail();

  let api;
  try {
    api = createApi(db);
  } catch {
    fail();
  }
  let prepared = null;
  let prepareAttempted = false;
  let processAttempted = false;

  return Object.freeze({
    async prepareViaFormalApi(input) {
      // Consume even a malformed first invocation. This wrapper has no
      // recovery or implicit second chance after a questionable input.
      if (prepareAttempted) fail();
      prepareAttempted = true;
      if (!input || typeof input !== 'object' || Object.keys(input).length !== 4) fail();
      const requested = Object.freeze({
        consumerUserId: input.consumerUserId,
        pictureBookId: input.pictureBookId,
        pageId: input.pageId,
        regenerate: input.regenerate,
      });
      try {
        const created = await api.prepareViaFormalApi(requested);
        const expected = SLOTS.find(
          (slot) => slot.pageId === requested.pageId && slot.regenerate === requested.regenerate,
        );
        if (
          !expected ||
          created?.pictureBookId !== scope.bookId ||
          created?.pageId !== expected.pageId ||
          created?.revisionNumber !== expected.revisionNumber ||
          created?.status !== 'QUEUED' ||
          !UUID.test(created.illustrationId ?? '')
        )
          fail();
        prepared = Object.freeze({ targetId: created.illustrationId, slot: expected });
        return created;
      } catch {
        fail();
      }
    },

    async processTargetIdWithAtomicGateOnce(input) {
      // Consume BEFORE constructing/awaiting the Worker. Unknown commit or
      // transport outcome never permits a second process invocation.
      if (processAttempted) fail();
      processAttempted = true;
      if (
        !prepared ||
        !input ||
        typeof input !== 'object' ||
        Object.keys(input).length !== 2 ||
        input.targetId !== prepared.targetId ||
        !matchesSlot(input.slot, prepared.slot)
      )
        fail();
      try {
        const worker = createWorker({
          db,
          targetIllustrationId: prepared.targetId,
          expectedSlot: prepared.slot,
          workspaceId,
          apiKey,
          imageTimeoutMs,
          bos,
          logger,
        });
        if (!worker || typeof worker.processTargetIdWithAtomicGateOnce !== 'function') fail();
        const result = await worker.processTargetIdWithAtomicGateOnce({
          targetId: prepared.targetId,
          slot: prepared.slot,
        });
        if (result !== prepared.targetId) fail();
        return result;
      } catch {
        fail();
      }
    },
  });
}
