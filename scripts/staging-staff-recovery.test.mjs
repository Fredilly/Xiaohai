import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  assertOperatorPermissions,
  assertRecoveryPassword,
  assertSingleStagingOperator,
  parseRecoveryArgs,
  requirePreparedExternalAudit,
  requireStagingRecoveryEnvironment,
} from './staging-staff-recovery-guards.mjs';
import { readHiddenLine, updateOnePasswordTransaction } from './staging-staff-recovery.mjs';

const id = '00000000-0000-4000-8000-000000000116';
const approval = 'https://github.com/Fredilly/Xiaohai/issues/116#issuecomment-12345';
const expected = {
  targetId: id,
  login: 'existing.staff@example.test',
  expectedSessionVersion: 3,
  approval,
};
const stagingEnv = {
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  SERVICE_NAME: 'api',
  DATABASE_URL: 'postgresql://xiaohai:secret@postgres:5432/xiaohai_staging',
};

test('deny any non-Staging environment or database identity', () => {
  assert.doesNotThrow(() => requireStagingRecoveryEnvironment(stagingEnv));
  for (const [name, value] of [
    ['APP_ENV', 'production'],
    ['APP_ENV', 'dev'],
    ['NODE_ENV', 'test'],
    ['SERVICE_NAME', 'worker'],
    ['DATABASE_URL', 'postgresql://xiaohai:secret@postgres:5432/xiaohai_production'],
    ['DATABASE_URL', 'postgresql://postgres:secret@postgres:5432/xiaohai_staging'],
    ['DATABASE_URL', 'postgresql://xiaohai:secret@external:5432/xiaohai_staging'],
    ['DATABASE_URL', 'postgresql://xiaohai:secret@postgres:5433/xiaohai_staging'],
    ['DATABASE_URL', 'https://example.test/xiaohai_staging'],
  ]) {
    assert.throws(
      () => requireStagingRecoveryEnvironment({ ...stagingEnv, [name]: value }),
      /RECOVERY_/,
      `${name}: ${value}`,
    );
  }
});

test('require explicit one-time target, session generation and issue approval', () => {
  const args = [
    '--execute',
    '--target-id',
    id,
    '--login',
    expected.login,
    '--expected-session-version',
    '3',
    '--approval',
    approval,
  ];
  assert.deepEqual(parseRecoveryArgs(args), expected);
  for (const broken of [
    [],
    args.slice(1),
    args.concat(['--unexpected']),
    args.map((s) => (s === id ? 'not-a-uuid' : s)),
    args.map((s) => (s === '3' ? '3.1' : s)),
    args.map((s) => (s === '3' ? '-1' : s)),
    args.map((s) => (s === approval ? 'https://example.com/approved' : s)),
  ]) {
    assert.throws(() => parseRecoveryArgs(broken), /RECOVERY_/);
  }
});

test('require a host-side external audit prerequisite', () => {
  assert.throws(() => requirePreparedExternalAudit(undefined), /AUDIT_NOT_PREPARED/);
  assert.throws(() => requirePreparedExternalAudit('true'), /AUDIT_NOT_PREPARED/);
  assert.doesNotThrow(() => requirePreparedExternalAudit('EXTERNAL_SSH_OPERATOR_AUDIT_PREPARED'));
});

test('reject extra enabled accounts, wrong target and stale session version', () => {
  const onlyAccount = {
    id,
    loginIdentifier: expected.login,
    sessionVersion: 3,
    enabled: true,
  };
  assert.deepEqual(assertSingleStagingOperator([onlyAccount], expected), onlyAccount);
  for (const accounts of [
    [],
    [{ ...onlyAccount, enabled: false }],
    [onlyAccount, { ...onlyAccount, id: 'second' }],
    [{ ...onlyAccount, id: 'wrong' }],
    [{ ...onlyAccount, loginIdentifier: 'unexpected' }],
    [{ ...onlyAccount, sessionVersion: 4 }],
  ]) {
    assert.throws(() => assertSingleStagingOperator(accounts, expected), /RECOVERY_/);
  }
});

test('reject role, permission and data-scope drift', () => {
  const roles = ['STAGING_UAT_OPERATOR'];
  const permissions = ['staff.manage', 'inventory.read'];
  const scopes = [{ scopeType: 'GLOBAL', scopeId: null }];
  assert.doesNotThrow(() => assertOperatorPermissions(roles, permissions, scopes));
  for (const variant of [
    [['OTHER_ADMIN'], permissions, scopes],
    [[...roles, 'LOCAL_HQ_ADMIN'], permissions, scopes],
    [roles, ['inventory.read'], scopes],
    [roles, permissions, [{ scopeType: 'STORE', scopeId: id }]],
    [roles, permissions, [...scopes, { scopeType: 'STORE', scopeId: id }]],
  ]) {
    assert.throws(() => assertOperatorPermissions(...variant), /RECOVERY_/);
  }
});

test('keep 12-128 characters, exact confirmation and nonempty hidden input', () => {
  assert.doesNotThrow(() => assertRecoveryPassword('long-enough-1234', 'long-enough-1234'));
  for (const [password, confirmation] of [
    ['shorter-11!', 'shorter-11!'],
    ['long-enough-1234', 'different-1234'],
    [' leading-space-12', ' leading-space-12'],
    ['long-enough-1234\n', 'long-enough-1234\n'],
    ['x'.repeat(129), 'x'.repeat(129)],
  ]) {
    assert.throws(() => assertRecoveryPassword(password, confirmation), /RECOVERY_/);
  }
});

test('hidden terminal input never echoes password and restores terminal mode', async () => {
  const input = new EventEmitter();
  input.isTTY = true;
  const raw = [];
  input.setRawMode = (value) => raw.push(value);
  input.setEncoding = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const output = {
    isTTY: true,
    recorded: '',
    write(value) {
      this.recorded += value;
    },
  };
  const pending = readHiddenLine('Hidden', input, output);
  input.emit('data', Buffer.from('twelve-char-pass\r'));
  const received = await pending;
  assert.equal(received, 'twelve-char-pass');
  assert.deepEqual(raw, [true, false]);
  assert.equal(output.recorded, 'Hidden: \n');
});

test('single password update is version-checked, inside SERIALIZABLE transaction, with no RBAC writes', async () => {
  const schema = {
    staffAccounts: {
      id: 'id',
      loginIdentifier: 'login',
      enabled: 'enabled',
      sessionVersion: 'generation',
    },
    staffRoles: 'staffRoles',
    roles: { id: 'roles.id', key: 'role-key' },
    permissions: { id: 'permissions.id', key: 'permission-key' },
    rolePermissions: { roleId: 'rolePermissions.id', permissionId: 'rolePermissions.permissionId' },
    staffDataScopes: {
      staffAccountId: 'staffDataScopes.id',
      scopeType: 'scopeType',
      scopeId: 'scopeId',
    },
  };
  const changedTables = [];
  const orm = {
    eq: (column, value) => ({ column, value }),
    and: (...clauses) => clauses,
    sql: (fragments, column) => ({ fragments, column }),
  };
  const tx = {
    select(fields) {
      return {
        from(table) {
          const read = {
            innerJoin() {
              return this;
            },
            async where() {
              if (table === schema.staffRoles && fields.key === schema.roles.key) {
                return [{ key: 'STAGING_UAT_OPERATOR' }];
              }
              if (table === schema.staffRoles) return [{ key: 'staff.manage' }];
              return [{ scopeType: 'GLOBAL', scopeId: null }];
            },
          };
          if (table === schema.staffAccounts) {
            return Promise.resolve([
              { id, loginIdentifier: expected.login, sessionVersion: 3, enabled: true },
            ]);
          }
          return read;
        },
      };
    },
    update(table) {
      changedTables.push(table);
      return {
        set(fields) {
          assert.deepEqual(Object.keys(fields).sort(), [
            'passwordHash',
            'sessionVersion',
            'updatedAt',
          ]);
          assert.equal(fields.passwordHash, 'mocked-scrypt-hash');
          return {
            where(conditions) {
              assert.equal(conditions.length, 4);
              return {
                async returning() {
                  return [{ sessionVersion: 4 }];
                },
              };
            },
          };
        },
      };
    },
  };
  const db = {
    async transaction(work, options) {
      assert.equal(options.isolationLevel, 'serializable');
      return work(tx);
    },
  };
  assert.equal(
    await updateOnePasswordTransaction(db, schema, orm, expected, 'mocked-scrypt-hash'),
    4,
  );
  assert.deepEqual(changedTables, [schema.staffAccounts]);
});
