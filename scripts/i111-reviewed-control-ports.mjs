import { withI111ExclusivePgLock } from './i111-exclusive-pg-lock.mjs';
import { createI111DatabaseEvidencePorts } from './i111-db-evidence-ports.mjs';
import { verifyI111OwnerGrantPort } from './i111-paid-operation-grant.mjs';

/**
 * Wire the real, independently implemented #111 control ports to the same
 * dedicated PostgreSQL session. No caller-provided "isApproved" or "dbPass"
 * boolean can replace the owner-grant verifier or the DB evidence readers.
 *
 * This is NOT an executable one-shot runner: it intentionally exposes no
 * readTrustedSnapshot, prepareViaFormalApi, verifyPaidBoundaryAtomically or
 * processTargetIdOnce port. Those must be independently source-bound and
 * checked in a separate reviewed Mac runtime before any paid invocation.
 */
export function createI111ReviewedControlPorts(pg) {
  if (!pg || typeof pg.query !== 'function') {
    throw new Error('I111_CONTROL_PORTS_STOP');
  }
  const db = createI111DatabaseEvidencePorts(pg);
  return Object.freeze({
    withExclusiveIsolation(callback) {
      return withI111ExclusivePgLock(pg, callback);
    },
    verifyOwnerOperationGrant: verifyI111OwnerGrantPort,
    verifySlotFreshBeforePrepare: db.verifySlotFreshBeforePrepare,
    verifyExactlyOneReservation: db.verifyExactlyOneReservation,
    readFinalEvidence: db.readFinalEvidence,
  });
}
