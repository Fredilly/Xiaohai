import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewIssues } from './check-pr-review-gates.mjs';

const body = '## Scope: this changes catalog safety. ## Why: prevent data loss. ## Testing: CI and rollback checks.';
const check = (files, patch = '', text = body, source = '') =>
  reviewIssues({ files, patch, body: text, readSource: () => source });

test('focused ISBN work passes', () => {
  assert.deepEqual(check(['packages/contracts/src/commerce.ts']), []);
});
test('focused HQ work passes with allowlisted errors', () => {
  assert.deepEqual(check(['apps/admin-web/src/catalog-manager.tsx'], '+ message: publicMessage(code),'), []);
});
test('mixed HQ and Meiping scope is rejected', () => {
  assert.match(check(['apps/admin-web/src/catalog-manager.tsx', 'apps/api/src/migration/meiping-apply-service.ts']).join(','), /Unrelated HQ/);
});
test('missing migration runbook or rollback plan fails', () => {
  assert.match(check(['packages/db/migrations/0041_example.sql']).join(','), /runbook/);
  assert.match(check(['packages/db/migrations/0041_example.sql', 'docs/0041_MIGRATION_RUNBOOK.md'], '', 'Migration 0041. Test only.').join(','), /rollback/);
});
test('dedicated migration with reconciliation passes', () => {
  assert.deepEqual(check(['packages/db/migrations/0041_example.sql', 'docs/0041_MIGRATION_RUNBOOK.md'], '', body + ' Migration 0041; rollback and reconciliation documented.'), []);
});
test('misleading HQ scope is rejected', () => {
  assert.match(check(['apps/admin-web/src/catalog-manager.tsx'], '', body + ' No HQ Admin Web changes.' ).join(','), /denies HQ/);
});
test('raw CommerceError messages are rejected', () => {
  assert.match(check(['apps/api/src/commerce/commerce-routes.ts'], '+ message: error instanceof CommerceError ? error.message : publicMessage(code)').join(','), /Raw exception/);
});
test('immutable history inserts cannot ignore conflicts', () => {
  assert.match(check(['apps/api/src/migration/meiping-review-service.ts'], '', body, '.insert(meipingReviewDecisionHistory).values({}).onConflictDoNothing()').join(','), /Immutable review history/);
});
