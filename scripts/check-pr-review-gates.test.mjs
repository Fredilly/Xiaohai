import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { reviewIssues } from './check-pr-review-gates.mjs';

const body =
  '## Scope: this changes catalog safety and preserves existing Staff permissions. ## Why: prevent data loss and unsafe public responses in future focused PRs. ## Testing: CI, authorization, idempotency, rollback and reconciliation checks.';
const check = (files, patch = '', text = body, source = '') =>
  reviewIssues({ files, patch, body: text, readSource: () => source });

test('focused ISBN work passes', () => {
  assert.deepEqual(check(['packages/contracts/src/commerce.ts']), []);
});
test('focused HQ work passes with allowlisted errors', () => {
  assert.deepEqual(
    check(['apps/admin-web/src/catalog-manager.tsx'], '+ message: publicMessage(code),'),
    [],
  );
});
test('mixed HQ and Meiping scope is rejected', () => {
  assert.match(
    check([
      'apps/admin-web/src/catalog-manager.tsx',
      'apps/api/src/migration/meiping-apply-service.ts',
    ]).join(','),
    /Unrelated HQ/,
  );
});
test('missing migration runbook or rollback plan fails', () => {
  assert.match(check(['packages/db/migrations/0041_example.sql']).join(','), /runbook/);
  assert.match(
    check(
      ['packages/db/migrations/0041_example.sql', 'docs/0041_MIGRATION_RUNBOOK.md'],
      '',
      'Migration 0041. Test only.',
    ).join(','),
    /rollback/,
  );
});
test('dedicated migration with reconciliation passes', () => {
  assert.deepEqual(
    check(
      ['packages/db/migrations/0041_example.sql', 'docs/0041_MIGRATION_RUNBOOK.md'],
      '',
      body + ' Migration 0041; rollback and reconciliation documented.',
    ),
    [],
  );
});
test('misleading HQ scope is rejected', () => {
  assert.match(
    check(['apps/admin-web/src/catalog-manager.tsx'], '', body + ' No HQ Admin Web changes.').join(
      ',',
    ),
    /denies HQ/,
  );
});
test('raw CommerceError messages are rejected', () => {
  assert.match(
    check(
      ['apps/api/src/commerce/commerce-routes.ts'],
      'diff --git a/apps/api/src/commerce/commerce-routes.ts b/apps/api/src/commerce/commerce-routes.ts\n+ message: error instanceof CommerceError ? error.message : publicMessage(code)',
    ).join(','),
    /Raw exception/,
  );
});
test('immutable history inserts cannot ignore conflicts', () => {
  assert.match(
    check(
      ['apps/api/src/migration/meiping-review-service.ts'],
      '',
      body,
      '.insert(meipingReviewDecisionHistory).values({}).onConflictDoNothing()',
    ).join(','),
    /Immutable review history/,
  );
});

test('PR review scope cannot be skipped, even if all other gates pass', () => {
  const check = (event, outcome) =>
    spawnSync('bash', ['scripts/check-pr-review-result.sh', event, outcome], {
      encoding: 'utf8',
    }).status;
  assert.equal(check('pull_request', 'success'), 0);
  assert.notEqual(check('pull_request', 'skipped'), 0);
  assert.notEqual(check('pull_request', 'failure'), 0);
  assert.notEqual(check('pull_request', ''), 0);
  assert.equal(check('push', 'skipped'), 0);
  assert.equal(check('push', 'success'), 0);
  assert.notEqual(check('push', 'failure'), 0);
  assert.notEqual(check('workflow_dispatch', 'skipped'), 0);
});

test('new unguarded PostgreSQL integration suites are blocked before human review', () => {
  const path = 'apps/api/test/new-apply.integration.test.ts';
  const diff = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  const unsafe = 'const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;';
  assert.match(check([path], diff, body, unsafe).join(','), /unchecked DATABASE_URL/);
  assert.match(
    check([path], diff, body, 'const db = createDatabase(process.env);').join(','),
    /fail-closed disposable DB guard/,
  );
  const guarded =
    'const database = assertMeipingApplyDisposableDatabase(process.env) ? createDatabase(process.env) : null;';
  assert.deepEqual(check([path], diff, body, guarded), []);
});

test('modifying an older suite cannot reintroduce unconditional DATABASE_URL access', () => {
  const path = 'apps/api/test/legacy.integration.test.ts';
  assert.match(
    check(
      [path],
      '',
      body,
      'const db = process.env.DATABASE_URL ? createDatabase(process.env) : null;',
    ).join(','),
    /unchecked DATABASE_URL/,
  );
});

test('a modified TRUNCATE suite cannot validate DATABASE_URL while using TEST_DATABASE_URL', () => {
  const path = 'apps/api/test/picture-book.integration.test.ts';
  const unsafe = [
    'const databaseUrl = process.env.DATABASE_URL;',
    'const safe = new URL(databaseUrl).pathname === "/xiaohai_test";',
    'const database = safe ? createDatabase(process.env) : null;',
    'await database.pool.query("TRUNCATE TABLE consumer_users CASCADE");',
  ].join('\n');
  assert.match(check([path], '', body, unsafe).join(','), /effective TEST_DATABASE_URL/);
});

test('a modified destructive suite must run the effective-target guard before connection', () => {
  const path = 'apps/api/test/picture-book.integration.test.ts';
  const unsafe = [
    'const database = createDatabase(process.env);',
    'assertMeipingApplyDisposableDatabase(process.env);',
    'await database.db.delete(consumerUsers);',
  ].join('\n');
  assert.match(check([path], '', body, unsafe).join(','), /effective TEST_DATABASE_URL/);
  const safe = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await database.pool.query("TRUNCATE TABLE consumer_users CASCADE");',
  ].join('\n');
  assert.deepEqual(check([path], '', body, safe), []);
});

test('a changed read-only integration suite does not trip the destructive gate', () => {
  const source =
    'const database = createDatabase(process.env); await database.db.select().from(books);';
  assert.deepEqual(check(['apps/api/test/read-only.integration.test.ts'], '', body, source), []);
});

test('new guarded integration suite cannot delete all user rows during cleanup', () => {
  const path = 'apps/api/test/refund-reservation.integration.test.ts';
  const diff = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  const unsafe = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await database.db.delete(consumerUsers);',
  ].join('\n');
  assert.match(check([path], diff, body, unsafe).join(','), /unscoped \\.delete\\(consumerUsers\\)/);
});

test('scoped multiline integration cleanup passes the review gate', () => {
  const path = 'apps/api/test/refund-reservation.integration.test.ts';
  const diff = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  const safe = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await database.db.delete(consumerUsers)',
    '  .where(eq(consumerUsers.id, fixture.userId));',
  ].join('\n');
  assert.deepEqual(check([path], diff, body, safe), []);
});

test('adding an unscoped delete to a legacy guarded suite fails', () => {
  const path = 'apps/api/test/commerce.integration.test.ts';
  const diff = [
    `diff --git a/${path} b/${path}`,
    '@@ -11,0 +12 @@',
    '+  await db.delete(consumerUsers);',
  ].join('\n');
  const source = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    '  await db.delete(consumerUsers);',
  ].join('\n');
  assert.match(check([path], diff, body, source).join(','), /unscoped \\.delete\\(consumerUsers\\)/);
});

test('unrelated legacy deletions are not re-litigated by a focused test update', () => {
  const path = 'apps/api/test/legacy.integration.test.ts';
  const diff = [
    `diff --git a/${path} b/${path}`,
    '@@ -25,0 +26 @@',
    '+  expect(account.status).toBe("ACTIVE");',
  ].join('\n');
  const source = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await database.db.delete(consumerUsers);',
    'expect(account.status).toBe("ACTIVE");',
  ].join('\n');
  assert.deepEqual(check([path], diff, body, source), []);
});

test('new scoped cleanup does not inherit an old unscoped delete warning', () => {
  const path = 'apps/api/test/legacy.integration.test.ts';
  const diff = [
    `diff --git a/${path} b/${path}`,
    '@@ -25,0 +26,2 @@',
    '+  await db.delete(orders)',
    '+    .where(eq(orders.id, fixture.orderId));',
  ].join('\n');
  const source = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await db.delete(consumerUsers);',
    '  await db.delete(orders)',
    '    .where(eq(orders.id, fixture.orderId));',
  ].join('\n');
  assert.deepEqual(check([path], diff, body, source), []);
});

test('returning() without where() remains an unsafe whole-table delete', () => {
  const path = 'apps/api/test/cleanup.integration.test.ts';
  const diff = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  const source = [
    'const database = assertMeipingApplyDisposableDatabase(process.env)',
    '  ? createDatabase(process.env) : null;',
    'await database.db.delete(orders).returning();',
  ].join('\n');
  assert.match(check([path], diff, body, source).join(','), /unscoped \\.delete\\(orders\\)/);
});
