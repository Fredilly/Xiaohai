#!/usr/bin/env node
// REVIEW-ONLY until Issue #116 explicitly approves the external SSH audit model.
// Copy this and staging-staff-recovery-guards.mjs into the *existing* Staging API
// container only after review. Never expose this as an API endpoint or ship it
// in a production image. The operational journal must be kept on the SSH host.
import { createRequire } from 'node:module';
import {
  assertOperatorPermissions,
  assertRecoveryPassword,
  assertSingleStagingOperator,
  parseRecoveryArgs,
  requirePreparedExternalAudit,
  requireStagingRecoveryEnvironment,
} from './staging-staff-recovery-guards.mjs';

const apiRuntime = '/app/apps/api';

export async function assertAccountAccess(db, schema, orm, expected) {
  const { staffAccounts, staffRoles, roles, permissions, rolePermissions, staffDataScopes } =
    schema;
  const { eq } = orm;
  // Do not select the old password hash, or include staff details in audit logs.
  const accounts = await db
    .select({
      id: staffAccounts.id,
      loginIdentifier: staffAccounts.loginIdentifier,
      enabled: staffAccounts.enabled,
      sessionVersion: staffAccounts.sessionVersion,
    })
    .from(staffAccounts);
  const target = assertSingleStagingOperator(accounts, expected);

  const roleRows = await db
    .select({ key: roles.key })
    .from(staffRoles)
    .innerJoin(roles, eq(staffRoles.roleId, roles.id))
    .where(eq(staffRoles.staffAccountId, target.id));
  const permissionRows = await db
    .select({ key: permissions.key })
    .from(staffRoles)
    .innerJoin(rolePermissions, eq(staffRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(staffRoles.staffAccountId, target.id));
  const scopes = await db
    .select({ scopeType: staffDataScopes.scopeType, scopeId: staffDataScopes.scopeId })
    .from(staffDataScopes)
    .where(eq(staffDataScopes.staffAccountId, target.id));
  assertOperatorPermissions(
    roleRows.map((row) => row.key),
    permissionRows.map((row) => row.key),
    scopes,
  );
}

export async function updateOnePasswordTransaction(db, schema, orm, expected, passwordHash) {
  const { staffAccounts } = schema;
  const { eq, and, sql } = orm;
  return db.transaction(
    async (tx) => {
      // Recheck inside SERIALIZABLE after the operator's hidden password input.
      await assertAccountAccess(tx, schema, orm, expected);
      const [updated] = await tx
        .update(staffAccounts)
        .set({
          passwordHash,
          sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(staffAccounts.id, expected.targetId),
            eq(staffAccounts.loginIdentifier, expected.login),
            eq(staffAccounts.enabled, true),
            eq(staffAccounts.sessionVersion, expected.expectedSessionVersion),
          ),
        )
        .returning({ sessionVersion: staffAccounts.sessionVersion });
      if (!updated || updated.sessionVersion !== expected.expectedSessionVersion + 1) {
        throw new Error('RECOVERY_CONCURRENT_CHANGE');
      }
      return updated.sessionVersion;
    },
    { isolationLevel: 'serializable' },
  );
}

// No password is echoed, even as masking asterisks, or written to a file.
export function readHiddenLine(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('RECOVERY_INTERACTIVE_TTY_REQUIRED');
  }
  return new Promise((resolve, reject) => {
    const characters = [];
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(characters.join(''));
    };
    const onEnd = () => finish(new Error('RECOVERY_TTY_CLOSED'));
    const onData = (bytes) => {
      for (const character of bytes.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u0003' || character === '\u0004' || character === '\u001b') {
          finish(new Error('RECOVERY_TTY_INTERRUPTED'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          characters.pop();
          continue;
        }
        if (/\p{Cc}/u.test(character) || characters.length >= 128) {
          finish(new Error('RECOVERY_PASSWORD_REJECTED'));
          return;
        }
        characters.push(character);
      }
    };
    output.write(`${label}: `);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
    input.on('end', onEnd);
  });
}

function emitAuditEvent(event) {
  // Non-secret, machine-readable record. The approved SSH runbook MUST keep a
  // durable mode-0600 host-level journal and identify the actual SSH principal.
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const expected = parseRecoveryArgs(args);
  requireStagingRecoveryEnvironment(env);
  requirePreparedExternalAudit(env.STAGING_RECOVERY_EXTERNAL_AUDIT);
  if (process.cwd() !== '/app' || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('RECOVERY_TRUSTED_API_CONTAINER_TTY_REQUIRED');
  }

  // Resolve already-compiled, existing production dependencies inside the
  // verified Staging API container. This tool never starts a new service.
  const requireFromApi = createRequire(`${apiRuntime}/package.json`);
  const orm = requireFromApi('drizzle-orm');
  const schema = await import('file:///app/packages/db/dist/src/index.js');
  const { ScryptPasswordHasher } = await import('file:///app/apps/api/dist/auth/password.js');
  const { db, pool } = schema.createDatabase(env);

  try {
    const identity = await pool.query(
      'select current_database() as db, current_user as role, pg_is_in_recovery() as standby',
    );
    const row = identity.rows[0];
    if (
      identity.rows.length !== 1 ||
      row.db !== 'xiaohai_staging' ||
      row.role !== 'xiaohai' ||
      row.standby !== false
    ) {
      throw new Error('RECOVERY_DATABASE_IDENTITY_MISMATCH');
    }
    await assertAccountAccess(db, schema, orm, expected);
    emitAuditEvent({
      event: 'STAGING_RECOVERY_PREFLIGHT_OK',
      targetId: expected.targetId,
      priorSessionVersion: expected.expectedSessionVersion,
      approval: expected.approval,
      database: 'xiaohai_staging',
      actorType: 'SSH_HOST_OPERATOR',
    });

    const password = await readHiddenLine('New Staging password (hidden)');
    const confirmation = await readHiddenLine('Confirm new password (hidden)');
    assertRecoveryPassword(password, confirmation);
    const passwordHash = await new ScryptPasswordHasher().hash(password);
    emitAuditEvent({
      event: 'STAGING_RECOVERY_COMMIT_ATTEMPT',
      targetId: expected.targetId,
      priorSessionVersion: expected.expectedSessionVersion,
      approval: expected.approval,
    });
    const nextSessionVersion = await updateOnePasswordTransaction(
      db,
      schema,
      orm,
      expected,
      passwordHash,
    );
    emitAuditEvent({
      event: 'STAGING_RECOVERY_COMMITTED',
      targetId: expected.targetId,
      priorSessionVersion: expected.expectedSessionVersion,
      nextSessionVersion,
      approval: expected.approval,
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('/staging-staff-recovery.mjs')) {
  main().catch((error) => {
    // Never serialize arbitrary exceptions (URLs, credentials or SQL might be inside).
    const message =
      error instanceof Error && error.message.startsWith('RECOVERY_')
        ? error.message
        : 'RECOVERY_EXECUTION_FAILED';
    emitAuditEvent({ event: 'STAGING_RECOVERY_STOPPED', reason: message });
    process.exitCode = 1;
  });
}
