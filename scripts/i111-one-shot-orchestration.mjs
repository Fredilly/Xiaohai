import { assessI111OneShotSnapshot, I111_ONE_SHOT_SCOPE } from './i111-one-shot-policy.mjs';

/**
 * #111 one-shot orchestration contract (code-only, NO live adapter).
 *
 * These ports are trusted server-side implementations, NOT values supplied by
 * an operator, CLI flags, a JSON file or a client. In particular, neither the
 * static snapshot nor a boolean in that snapshot grants permission to spend.
 * This module deliberately has no executable entrypoint, credentials, socket
 * client, HTTP client, retries or provider import. A separately reviewed live
 * adapter must verify the owner grant and hold an exclusive runtime lock.
 */

const NEXT = Object.freeze([
  Object.freeze({ pageId: I111_ONE_SHOT_SCOPE.page1Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 2, regenerate: true }),
]);

const CODES = Object.freeze({
  PORTS: 'I111_EXECUTOR_PORTS_UNAVAILABLE',
  LOCK: 'I111_EXCLUSIVE_LOCK_REQUIRED',
  PREFLIGHT: 'I111_EXECUTOR_PREFLIGHT_STOP',
  APPROVAL: 'I111_OPERATION_APPROVAL_REQUIRED',
  SLOT: 'I111_EXECUTOR_SLOT_MISMATCH',
  RESERVATION: 'I111_EXECUTOR_RESERVATION_UNVERIFIED',
  PROCESS: 'I111_EXECUTOR_PROCESS_UNVERIFIED',
  RESULT: 'I111_EXECUTOR_RESULT_UNVERIFIED',
  UNKNOWN: 'I111_EXECUTOR_OUTCOME_UNCERTAIN',
  RECONCILE: 'I111_EXECUTOR_RECONCILIATION_REQUIRED',
});

class Stop extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function stop(code) {
  return { verdict: 'STOP', errorCode: code, paidExecutionAuthorized: false };
}

function assert(condition, code) {
  if (!condition) throw new Stop(code);
}

/**
 * A fixed-code, non-operational preview of the next allowed slot. No values
 * from the snapshot are returned to logs except the hardcoded page/revision.
 */
export function previewI111OneShot(snapshot) {
  const assessment = assessI111OneShotSnapshot(snapshot);
  if (assessment.verdict !== 'STATIC_REVIEW_ONLY') return stop(CODES.PREFLIGHT);
  const next = NEXT[snapshot.attempts.length];
  if (!next) return stop(CODES.SLOT);
  return {
    verdict: 'STATIC_REVIEW_ONLY',
    nextPageId: next.pageId,
    nextRevisionNumber: next.revisionNumber,
    paidExecutionAuthorized: false,
  };
}

/**
 * A testable ONE invocation / ONE target-ID sequence for a FUTURE trusted
 * adapter. No live adapter is included or exported here. The adapter must:
 *  - hold a real exclusive DB/runtime lease across this entire callback,
 *  - independently collect and authenticate each preflight fact,
 *  - independently verify an owner-scoped one-time operation grant bound to
 *    the exact merged code SHA, resource allowlist and price limit,
 *  - under that lock prove no previous active illustration/reservation for
 *    this slot before the formal API transaction,
 *  - call the formal PictureBookService.generateIllustration transaction,
 *  - validate its one newly created reservation and the final target-ID Worker,
 *  - consume the atomic provider-attempt marker INSIDE the exact-ID Worker,
 *    immediately before its one guarded paid transport. A separate boolean
 *    pre-check cannot authorize a later network request (TOCTOU).
 *
 * Ports are purposely injected instead of wired to real services: this PR
 * cannot start an API, a Worker, a BOS GET or a paid POST from a CLI.
 * Even an accepted provider result is STOP until separately invoiced and
 * reconciled; the next invocation never occurs automatically.
 */
export async function coordinateI111OneShot(ports) {
  const required = [
    'withExclusiveIsolation',
    'readTrustedSnapshot',
    'verifyOwnerOperationGrant',
    'verifySlotFreshBeforePrepare',
    'prepareViaFormalApi',
    'verifyExactlyOneReservation',
    'processTargetIdWithAtomicGateOnce',
    'readFinalEvidence',
  ];
  if (!ports || required.some((key) => typeof ports[key] !== 'function')) {
    return stop(CODES.PORTS);
  }

  try {
    let lockInvocations = 0;
    let lockComplete = false;
    await ports.withExclusiveIsolation(async () => {
      lockInvocations += 1;
      assert(lockInvocations === 1, CODES.LOCK);

      const snapshot = await ports.readTrustedSnapshot();
      const plan = previewI111OneShot(snapshot);
      assert(plan.verdict === 'STATIC_REVIEW_ONLY', CODES.PREFLIGHT);
      const slot = NEXT[snapshot.attempts.length];
      assert(slot, CODES.SLOT);

      // The grant source must be independent of the local snapshot and must
      // bind the exact SHA/slot. A caller-supplied approval flag is never read.
      const grant = await ports.verifyOwnerOperationGrant({
        exactCodeSha: snapshot.checkedOutSha,
        bookId: I111_ONE_SHOT_SCOPE.bookId,
        pageId: slot.pageId,
        revisionNumber: slot.revisionNumber,
        maxCalls: I111_ONE_SHOT_SCOPE.maxCalls,
        maxSpendMinor: I111_ONE_SHOT_SCOPE.budgetLimitMinor,
      });
      assert(grant === 'INDEPENDENT_VERIFIED_ONE_TIME_GRANT', CODES.APPROVAL);

      // An existing QUEUED/RUNNING illustration would make the normal API
      // return that old ID; it must NOT be interpreted as a new paid attempt.
      assert((await ports.verifySlotFreshBeforePrepare({ slot })) === true, CODES.SLOT);

      // No optimistic pre-creation: the formal API transaction must reserve
      // exactly one illustration; never send its general Redis notification to
      // a running generic Worker in the isolated Mac environment.
      const created = await ports.prepareViaFormalApi({
        consumerUserId: I111_ONE_SHOT_SCOPE.ownerId,
        pictureBookId: I111_ONE_SHOT_SCOPE.bookId,
        pageId: slot.pageId,
        regenerate: slot.regenerate,
      });
      assert(
        created &&
          created.pictureBookId === I111_ONE_SHOT_SCOPE.bookId &&
          created.pageId === slot.pageId &&
          created.revisionNumber === slot.revisionNumber &&
          created.status === 'QUEUED' &&
          typeof created.illustrationId === 'string' &&
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(created.illustrationId),
        CODES.SLOT,
      );
      const targetId = created.illustrationId;

      assert(
        (await ports.verifyExactlyOneReservation({ targetId, slot })) === true,
        CODES.RESERVATION,
      );
      // This MUST be a source-bound, inseparable exact-ID Worker operation:
      // claim targetId -> consumeI111ProviderSlot (atomic AT_RISK marker) ->
      // one guarded provider POST. An independently supplied boolean result
      // cannot grant permission to perform the POST in a later operation.
      // Never retry on an exception, timeout, null or unknown outcome.
      const processedId = await ports.processTargetIdWithAtomicGateOnce({ targetId, slot });
      assert(processedId === targetId, CODES.PROCESS);
      const final = await ports.readFinalEvidence(targetId);
      assert(
        final &&
          final.illustrationId === targetId &&
          final.status === 'SUCCEEDED' &&
          final.mediaStatus === 'READY' &&
          final.reservationStatus === 'AT_RISK' &&
          final.ledgerStatus === 'AT_RISK',
        CODES.RESULT,
      );
      lockComplete = true;
    });
    assert(lockInvocations === 1 && lockComplete, CODES.LOCK);
    return stop(CODES.RECONCILE);
  } catch (error) {
    // Never log error.message or provider responses. The caller sees only an
    // allowlisted fixed code; if a side effect may already have happened,
    // UNKNOWN remains a hard STOP with NO automatic attempt recovery.
    return stop(error instanceof Stop ? error.code : CODES.UNKNOWN);
  }
}

// Runtime code MUST NOT use this helper as proof of owner authorization.
// This contract intentionally contains no function capable of producing a
// verified operation grant from GitHub, a filesystem document or CLI flags.
