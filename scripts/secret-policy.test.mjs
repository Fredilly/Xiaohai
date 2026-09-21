import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { containsSecret, secretFile } from './secret-policy.mjs';

test('blocks private configuration, accepts examples', () => {
  assert.equal(secretFile('apps/api/.env.production'), true);
  assert.equal(secretFile('.env.example'), false);
  assert.equal(secretFile('apps/miniapp/project.private.config.json'), true);
});
test('detects credentials without flagging safe placeholders', () => {
  assert.equal(containsSecret('gh' + 'p_' + 'A'.repeat(40)), true);
  assert.equal(containsSecret('xox' + 'b-' + 'A'.repeat(30)), true);
  assert.equal(containsSecret('sk-' + 'a'.repeat(25)), true);
  assert.equal(containsSecret('WECHAT_APP_SECRET=replace-with-your-secret'), false);
});
