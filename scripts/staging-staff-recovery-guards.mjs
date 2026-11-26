// A one-time Staging operator procedure, never an HTTP authentication bypass.
// This module is deliberately dependency-free so the fail-closed guards can be
// reviewed and tested without database credentials or a running server.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issueCommentPattern =
  /^https:\/\/github\.com\/Fredilly\/Xiaohai\/issues\/116#issuecomment-\d+$/;

export function requireStagingRecoveryEnvironment(env) {
  if (env.APP_ENV !== 'staging' || env.NODE_ENV !== 'production' || env.SERVICE_NAME !== 'api') {
    throw new Error('RECOVERY_ENVIRONMENT_MISMATCH');
  }
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('RECOVERY_DATABASE_IDENTITY_MISMATCH');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== 'postgres' ||
    url.port !== '5432' ||
    url.username !== 'xiaohai' ||
    decodeURIComponent(url.pathname) !== '/xiaohai_staging' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('RECOVERY_DATABASE_IDENTITY_MISMATCH');
  }
}

export function parseRecoveryArgs(args) {
  if (args.length !== 9 || args[0] !== '--execute') {
    throw new Error('RECOVERY_EXPLICIT_EXECUTE_REQUIRED');
  }
  const names = ['--target-id', '--login', '--expected-session-version', '--approval'];
  for (let i = 0; i < names.length; i += 1) {
    if (args[i * 2 + 1] !== names[i]) throw new Error('RECOVERY_ARGUMENTS_INVALID');
  }
  const targetId = args[2];
  const login = args[4];
  const expectedSessionVersion = Number(args[6]);
  const approval = args[8];
  if (
    !uuidPattern.test(targetId) ||
    typeof login !== 'string' ||
    login.length < 3 ||
    login.length > 120 ||
    !/^(0|[1-9]\d*)$/.test(args[6]) ||
    !Number.isSafeInteger(expectedSessionVersion) ||
    expectedSessionVersion < 0 ||
    !issueCommentPattern.test(approval)
  ) {
    throw new Error('RECOVERY_ARGUMENTS_INVALID');
  }
  return { targetId, login, expectedSessionVersion, approval };
}

export function assertSingleStagingOperator(rows, expected) {
  if (!Array.isArray(rows)) throw new Error('RECOVERY_ACCOUNT_COUNT_MISMATCH');
  const enabled = rows.filter((row) => row.enabled);
  if (enabled.length !== 1) throw new Error('RECOVERY_ACCOUNT_COUNT_MISMATCH');
  const operator = enabled[0];
  if (
    operator.id !== expected.targetId ||
    operator.loginIdentifier !== expected.login ||
    operator.sessionVersion !== expected.expectedSessionVersion
  ) {
    throw new Error('RECOVERY_TARGET_MISMATCH');
  }
  return operator;
}

export function assertOperatorPermissions(roleKeys, permissionKeys, scopes) {
  if (
    roleKeys.length !== 1 ||
    roleKeys[0] !== 'STAGING_UAT_OPERATOR' ||
    !permissionKeys.includes('staff.manage') ||
    scopes.length !== 1 ||
    scopes[0].scopeType !== 'GLOBAL' ||
    scopes[0].scopeId !== null
  ) {
    throw new Error('RECOVERY_AUTHORIZATION_MISMATCH');
  }
}

export function requirePreparedExternalAudit(value) {
  // Only a second, host-audited runbook may supply this marker; it is not
  // permission to invent an actor_staff_account_id in audit_logs.
  if (value !== 'EXTERNAL_SSH_OPERATOR_AUDIT_PREPARED') {
    throw new Error('RECOVERY_EXTERNAL_AUDIT_NOT_PREPARED');
  }
}

export function assertRecoveryPassword(password, confirmation) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128 ||
    password.trim() !== password ||
    /[\r\n\0]/.test(password) ||
    password !== confirmation
  ) {
    throw new Error('RECOVERY_PASSWORD_REJECTED');
  }
}
