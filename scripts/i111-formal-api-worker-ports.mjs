import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

/**
 * Bind the existing PictureBookService.generateIllustration transaction and
 * exact-ID ImageJobProcessor.processOne for the trusted #111 coordinator.
 *
 * This is a narrow, code-only port adapter, NOT a runnable executor or a paid
 * authorization gate. The future reviewed runtime must instantiate the real
 * PictureBookService / ImageJobProcessor from reviewed source, validate their
 * dependencies and call these ports ONLY from coordinateI111OneShot after
 * fresh owner permission and independent atomic paid-boundary proof.
 * No provider, DB connection, Redis queue or remote request is created here.
 */

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const STOP_CODE = 'I111_FORMAL_API_WORKER_STOP';
const ALLOWED = Object.freeze([
  Object.freeze({ pageId: scope.page1Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 2, regenerate: true }),
]);

class Stop extends Error {
  constructor() {
    super(STOP_CODE);
  }
}

function allowedInput(input) {
  return (
    input &&
    typeof input === 'object' &&
    Object.keys(input).length === 4 &&
    input.consumerUserId === scope.ownerId &&
    input.pictureBookId === scope.bookId &&
    ALLOWED.some((slot) => slot.pageId === input.pageId && slot.regenerate === input.regenerate)
  );
}

/**
 * The existing formal API method normally sends a Redis notification; the
 * isolated one-shot uses its exact DB transaction but MUST NOT enqueue a
 * generic Worker. Instead the coordinator will process the newly returned ID
 * directly after its independent reservation + boundary verifications.
 */
export function createI111NoBroadcastImageQueue() {
  let notifiedId = null;
  let violated = false;
  return Object.freeze({
    async notify(illustrationId) {
      if (violated || !UUID.test(illustrationId ?? '') || notifiedId !== null) {
        violated = true;
        throw new Stop();
      }
      notifiedId = illustrationId;
    },
    async close() {},
    notificationSummary() {
      return violated ? 'VIOLATION' : notifiedId === null ? 'NONE' : 'SINGLE_NO_BROADCAST';
    },
    confirmedNotificationId() {
      return notifiedId;
    },
  });
}

/** Any accidental use of text-job queue operations is an immediate STOP. */
export function createI111DisabledTextQueue() {
  return new Proxy(Object.freeze({}), {
    get() {
      throw new Stop();
    },
  });
}

/**
 * Accept the REAL service instance and a factory that constructs a dedicated
 * ImageJobProcessor(db, BailianImageProvider, ..., exactIllustrationId).
 * These are trusted server-side dependencies, not operator-provided JSON,
 * CLI flags or extension callbacks. Not safe to call outside the coordinator.
 */
export function createI111FormalApiWorkerPorts({ apiService, imageQueue, createTargetWorker }) {
  if (
    !apiService ||
    typeof apiService.generateIllustration !== 'function' ||
    !imageQueue ||
    typeof imageQueue.confirmedNotificationId !== 'function' ||
    typeof imageQueue.notificationSummary !== 'function' ||
    typeof createTargetWorker !== 'function'
  )
    throw new Stop();

  let prepareAttempted = false;
  let processAttempted = false;
  let preparedId = null;

  return Object.freeze({
    async prepareViaFormalApi(input) {
      if (prepareAttempted || !allowedInput(input)) throw new Stop();
      // Mark BEFORE entering a transaction: an exception may conceal a
      // committed reservation. No retry or fallback to a second API call.
      prepareAttempted = true;
      let created;
      try {
        created = await apiService.generateIllustration(
          input.consumerUserId,
          input.pictureBookId,
          input.pageId,
          input.regenerate,
        );
      } catch {
        throw new Stop();
      }
      if (
        !created ||
        created.pictureBookId !== scope.bookId ||
        created.pageId !== input.pageId ||
        created.status !== 'QUEUED' ||
        !UUID.test(created.illustrationId ?? '') ||
        !ALLOWED.some(
          (slot) =>
            slot.pageId === input.pageId &&
            slot.revisionNumber === created.revisionNumber &&
            slot.regenerate === input.regenerate,
        ) ||
        imageQueue.confirmedNotificationId() !== created.illustrationId ||
        imageQueue.notificationSummary() !== 'SINGLE_NO_BROADCAST'
      )
        throw new Stop();
      preparedId = created.illustrationId;
      return Object.freeze({
        pictureBookId: scope.bookId,
        pageId: input.pageId,
        revisionNumber: created.revisionNumber,
        illustrationId: preparedId,
        status: 'QUEUED',
      });
    },
    async processTargetIdOnce(targetId) {
      if (
        !prepareAttempted ||
        processAttempted ||
        preparedId === null ||
        targetId !== preparedId ||
        !UUID.test(targetId ?? '')
      )
        throw new Stop();
      // Consume the one-time call BEFORE instantiating/awaiting the Worker.
      // If the provider responds ambiguously, never try again.
      processAttempted = true;
      let worker;
      try {
        worker = await createTargetWorker(targetId);
        if (!worker || typeof worker.processOne !== 'function') throw new Stop();
        const processed = await worker.processOne();
        if (processed !== targetId) throw new Stop();
        return processed;
      } catch {
        throw new Stop();
      }
    },
  });
}
