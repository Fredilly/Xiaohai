import { expect, test } from '@playwright/test';

test('M1 test runner is configured', () => {
  expect(['dev', 'staging', 'production']).toContain('dev');
});
